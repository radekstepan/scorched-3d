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
  BLOCKED_KEEPOUT,
  cellTraverseCost,
  findCellPath,
  findWorldPath,
  formationOffsets,
  formationTargets,
  FORMATION_MIN_SEPARATION,
  hasLineOfSight,
  isObstructedCell,
  isRockCell,
  isTreeCell,
  isWalkable,
  legClipsBlocked,
  legClipsTrunk,
  legCrossesObstruction,
  nearestWalkable,
  octileHeuristic,
  PATH_FORMATION_SPACING,
  PATH_MAX_SLOPE,
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
  it("holds the retail-tank climb limit", () => {
    // Stock retail tank classes (TANKSH/TANKBH) block past MaxSlope 15;
    // the old 24-gate let hulls scale grades no tank should climb.
    expect(PATH_MAX_SLOPE).toBe(15);
  });

  it("refuses cone grades the old gate walked", () => {
    // A 20-raw grade (typical archipelago volcano flank) is unwalkable now:
    // A* must route around it instead of marching over the cone — while a
    // 15-grade (the steepest legal climb) still walks.
    const w = 32;
    const h = 12;
    const flank: PathGrid = { width: w, height: h, heights: new Uint8Array(w * h), seaLevel: 0 };
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) flank.heights[z * w + x] = x * 20;
    }
    expect(isWalkable(flank, 8, 5)).toBe(false);
    const edge: PathGrid = { width: w, height: h, heights: new Uint8Array(w * h), seaLevel: 0 };
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) edge.heights[z * w + x] = 60 + x * 15;
    }
    expect(isWalkable(edge, 8, 5)).toBe(true);
  });

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
    for (const preset of ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"] as const) {
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

describe("rough-terrain costs", () => {
  /** Flat dry grid with an optional feature word painted on cells. */
  function woodedGrid(): PathGrid {
    const w = 24;
    const h = 12;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    // Tree block straddling the direct lane (rows 4–6, cols 8–15).
    for (let z = 4; z <= 6; z++) {
      for (let x = 8; x <= 15; x++) features[z * w + x] = 0;
    }
    // One rock + one metal cell for the classifier checks.
    features[2 * w + 2] = 3;
    features[2 * w + 3] = 5;
    return { width: w, height: h, heights, seaLevel: 50, features };
  }

  it("classifies tree/rock cells, ignoring empty ground and missing features", () => {
    const grid = woodedGrid();
    expect(isTreeCell(grid, 10, 5)).toBe(true);
    expect(isRockCell(grid, 10, 5)).toBe(false);
    expect(isObstructedCell(grid, 10, 5)).toBe(true);
    expect(isRockCell(grid, 2, 2)).toBe(true);
    expect(isRockCell(grid, 3, 2)).toBe(true);
    expect(isObstructedCell(grid, 2, 2)).toBe(true);
    expect(isTreeCell(grid, 2, 2)).toBe(false);
    expect(isObstructedCell(grid, 5, 5)).toBe(false);
    // Feature-less grids read as open ground.
    const bare = flatGrid();
    expect(isTreeCell(bare, 5, 5)).toBe(false);
    expect(isRockCell(bare, 5, 5)).toBe(false);
    expect(cellTraverseCost(bare, 5, 5)).toBe(1);
  });

  it("prices open < slope < woods < rocks", () => {
    const grid = woodedGrid();
    const open = cellTraverseCost(grid, 5, 5);
    expect(open).toBe(1);
    expect(cellTraverseCost(grid, 10, 5)).toBeGreaterThan(open);
    expect(cellTraverseCost(grid, 2, 2)).toBeGreaterThan(cellTraverseCost(grid, 10, 5));
    // Slope tiers on feature-less ramps: steeper costs more, gentle stays 1.
    const gentle = flatGrid();
    expect(cellTraverseCost(gentle, 5, 5)).toBe(1);
    const ramped: PathGrid = { width: 12, height: 12, heights: new Uint8Array(12 * 12), seaLevel: 0 };
    for (let z = 0; z < 12; z++) {
      for (let x = 0; x < 12; x++) ramped.heights[z * 12 + x] = 100 + x * 16;
    }
    expect(cellTraverseCost(ramped, 5, 5)).toBeGreaterThan(1);
  });

  it("tiers rough grades below the climb gate", () => {
    // Cost bands sit at ~1/3, 3/5, 4/5 of the 15-gate: gentle ground stays
    // 1, near-gate grades pay steep, and the top band stops where the
    // walkability gate takes over (slopes past 15 never reach costing).
    const ramp = (per: number): PathGrid => {
      const g: PathGrid = { width: 12, height: 12, heights: new Uint8Array(12 * 12), seaLevel: 0 };
      for (let z = 0; z < 12; z++) {
        for (let x = 0; x < 12; x++) g.heights[z * 12 + x] = x * per;
      }
      return g;
    };
    expect(cellTraverseCost(ramp(4), 5, 5)).toBe(1);
    expect(cellTraverseCost(ramp(8), 5, 5)).toBe(1.5);
    expect(cellTraverseCost(ramp(11), 5, 5)).toBe(2.5);
    expect(cellTraverseCost(ramp(14), 5, 5)).toBe(4);
    expect(isWalkable(ramp(14), 5, 5)).toBe(true);
    expect(isWalkable(ramp(16), 5, 5)).toBe(false);
  });

  it("detours around woods instead of marching through them", () => {
    const grid = woodedGrid();
    const path = findCellPath(grid, { cellX: 2, cellZ: 5 }, { cellX: 21, cellZ: 5 });
    expect(path).not.toBeNull();
    for (const c of path!) expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
    // The direct lane is tree-filled: the cost-weighted search walks around
    // it instead of through it (a cost-blind search would run straight).
    for (const c of path!) expect(isTreeCell(grid, c.cellX, c.cellZ)).toBe(false);
    expect(findCellPath(grid, { cellX: 2, cellZ: 5 }, { cellX: 21, cellZ: 5 })).toEqual(path);
  });

  it("keeps smoothing from pulling the wood detour back through the trees", () => {
    const grid = woodedGrid();
    const around = [
      { cellX: 2, cellZ: 5 },
      { cellX: 2, cellZ: 1 },
      { cellX: 21, cellZ: 1 },
      { cellX: 21, cellZ: 5 },
    ];
    // The straight shortcut crosses the tree block interior.
    expect(legCrossesObstruction(grid, around[0]!, around[3]!)).toBe(true);
    expect(hasLineOfSight(grid, around[0]!, around[3]!)).toBe(true);
    const smoothed = smoothCellPath(grid, around);
    expect(smoothed.length).toBeGreaterThanOrEqual(3);
    expect(smoothed[0]).toEqual(around[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(around[3]);
    // Same shape on open ground still collapses to its endpoints.
    expect(legCrossesObstruction(flatGrid(), around[0]!, around[3]!)).toBe(false);
    expect(smoothCellPath(flatGrid(), around)).toEqual([around[0], around[3]]);
  });
});

describe("trunk keepout in pathing", () => {
  /** Open 12×12 grid with one standing tree at (5, 5). */
  function loneTreeGrid(): PathGrid {
    const w = 12;
    const h = 12;
    const features = new Uint16Array(w * h).fill(0xffff);
    features[5 * w + 5] = 0;
    return { width: w, height: h, heights: new Uint8Array(w * h).fill(100), seaLevel: 0, features };
  }

  function toWorld(grid: PathGrid, x: number, z: number): { x: number; z: number } {
    return { x: (x - (grid.width - 1) / 2) * 16, z: (z - (grid.height - 1) / 2) * 16 };
  }

  it("flags legs grazing a trunk even when no tree cell is sampled", () => {
    const grid = loneTreeGrid();
    // Corner graze past (5,5): the half-cell samples land on (3,6), (4,5),
    // (5,4), (6,3) — never the tree cell — yet the hull would pass ~11
    // world units from the trunk, inside the keepout.
    const a = { cellX: 3, cellZ: 6 };
    const b = { cellX: 6, cellZ: 3 };
    expect(hasLineOfSight(grid, a, b)).toBe(true);
    expect(legCrossesObstruction(grid, a, b)).toBe(false);
    expect(legClipsTrunk(grid, a, b)).toBe(true);
    // Legs well clear of the trunk stay clean, as do feature-less grids.
    expect(legClipsTrunk(grid, { cellX: 0, cellZ: 0 }, { cellX: 0, cellZ: 11 })).toBe(false);
    expect(legClipsTrunk(flatGrid(), a, b)).toBe(false);
    // Arriving on the trunk itself counts as clipping.
    expect(legClipsTrunk(grid, { cellX: 2, cellZ: 5 }, { cellX: 5, cellZ: 5 })).toBe(true);
  });

  it("refuses trunk-grazing shortcuts when smoothing", () => {
    const grid = loneTreeGrid();
    const cells = [
      { cellX: 3, cellZ: 6 },
      { cellX: 4, cellZ: 5 },
      { cellX: 6, cellZ: 3 },
    ];
    // The direct shortcut grazes the trunk, so the middle waypoint stays.
    expect(smoothCellPath(grid, cells)).toEqual(cells);
    // Same shape on open ground collapses to its endpoints.
    expect(smoothCellPath(flatGrid(), cells)).toEqual([cells[0], cells[2]]);
  });

  it("snaps order endpoints off trunks, staying walkable in dense woods", () => {
    const grid = loneTreeGrid();
    // The trunk cell itself snaps to the nearest open cell (ring order hits
    // smaller z first, so (4,4)).
    const near = nearestWalkable(grid, 5, 5);
    expect(near).toEqual({ cellX: 4, cellZ: 4 });
    expect(isWalkable(grid, near.cellX, near.cellZ)).toBe(true);
    // End-to-end: a goal clicked on the trunk arrives beside it instead.
    const path = findWorldPath(grid, toWorld(grid, 0, 0), toWorld(grid, 5, 5));
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1]!;
    const cell = pathWorldToCell(grid, last.x, last.z);
    expect(isTreeCell(grid, cell.cellX, cell.cellZ)).toBe(false);
    expect(isWalkable(grid, cell.cellX, cell.cellZ)).toBe(true);
    // Dense fallback: every cell a tree — the snap stays walkable.
    const dense: PathGrid = {
      width: 8,
      height: 8,
      heights: new Uint8Array(64).fill(100),
      seaLevel: 0,
      features: new Uint16Array(64).fill(0),
    };
    const d = nearestWalkable(dense, 4, 4);
    expect(isWalkable(dense, d.cellX, d.cellZ)).toBe(true);
    expect(findWorldPath(dense, { x: 0, z: 0 }, { x: 16, z: 16 }).length).toBeGreaterThan(0);
  });

  it("seats formation goals off trunks when open ground is near", () => {
    const grid = loneTreeGrid();
    const center = toWorld(grid, 10, 5);
    const goals = snappedFormationTargets(grid, center, 3, 8);
    expect(goals).toHaveLength(3);
    expect(snappedFormationTargets(grid, center, 3, 8)).toEqual(goals);
    for (const g of goals) {
      const cell = pathWorldToCell(grid, g.x, g.z);
      expect(isWalkable(grid, cell.cellX, cell.cellZ)).toBe(true);
      expect(isTreeCell(grid, cell.cellX, cell.cellZ)).toBe(false);
    }
  });
});

describe("blocked keepout in smoothing", () => {
  /** Open 12×12 grid with one graduated pond cell at (5, 5). */
  function lonePondGrid(): PathGrid {
    const w = 12;
    const h = 12;
    const heights = new Uint8Array(w * h).fill(60);
    heights[5 * w + 5] = 52;
    return { width: w, height: h, heights, seaLevel: 50 };
  }

  it("flags legs threading a water corner that line of sight misses", () => {
    const grid = lonePondGrid();
    expect(isWalkable(grid, 5, 5)).toBe(false);
    expect(isWalkable(grid, 4, 5)).toBe(true);
    expect(isWalkable(grid, 5, 4)).toBe(true);
    // Corner graze past (5,5): the half-cell samples never land on the pond
    // cell, yet the leg passes ~11 world units from its center — inside the
    // keepout, close enough to beach a homing hull nose-on.
    const a = { cellX: 3, cellZ: 6 };
    const b = { cellX: 6, cellZ: 3 };
    expect(hasLineOfSight(grid, a, b)).toBe(true);
    expect(legClipsBlocked(grid, a, b)).toBe(true);
    expect(BLOCKED_KEEPOUT).toBeLessThan(16);
    // Legs down a neighbouring lane clear the pond by a full cell width.
    expect(legClipsBlocked(grid, { cellX: 3, cellZ: 4 }, { cellX: 8, cellZ: 4 })).toBe(false);
    expect(legClipsBlocked(grid, { cellX: 0, cellZ: 0 }, { cellX: 0, cellZ: 11 })).toBe(false);
    // A straight arrival at a shoreline cell clears: the leg ends a full
    // cell from the water it sits beside.
    expect(legClipsBlocked(grid, { cellX: 2, cellZ: 5 }, { cellX: 4, cellZ: 5 })).toBe(false);
    // Fully open ground never clips.
    expect(legClipsBlocked(flatGrid(), a, b)).toBe(false);
  });

  it("refuses water-grazing shortcuts when smoothing", () => {
    const grid = lonePondGrid();
    const cells = [
      { cellX: 3, cellZ: 6 },
      { cellX: 4, cellZ: 5 },
      { cellX: 6, cellZ: 3 },
    ];
    // The direct shortcut threads the pond corner, so the middle waypoint stays.
    expect(smoothCellPath(grid, cells)).toEqual(cells);
    // Same shape on open ground collapses to its endpoints.
    expect(smoothCellPath(flatGrid(), cells)).toEqual([cells[0], cells[2]]);
  });
});

describe("forest through-vs-around choice", () => {
  /** Grid with a tree stand over columns x0–x1 and rows z0–z1. */
  function forestGrid(x0: number, x1: number, z0: number, z1: number): PathGrid {
    const w = 24;
    const h = 12;
    const heights = new Uint8Array(w * h).fill(100);
    const features = new Uint16Array(w * h).fill(0xffff);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) features[z * w + x] = 0;
    }
    return { width: w, height: h, heights, seaLevel: 50, features };
  }

  function treeCells(grid: PathGrid, path: { cellX: number; cellZ: number }[]): number {
    return path.filter((c) => isTreeCell(grid, c.cellX, c.cellZ)).length;
  }

  it("crushes through a narrow thicket when both flanks are longer", () => {
    // A 2-wide × 10-deep stand astride the lane: slipping around either end
    // costs ~8 extra cells of open running, while crushing the two lane
    // cells pays the wood price twice — so the lane through wins overall
    // and the search takes it instead of wandering to the far end.
    const grid = forestGrid(11, 12, 1, 10);
    const start = { cellX: 2, cellZ: 5 };
    const goal = { cellX: 21, cellZ: 5 };
    const path = findCellPath(grid, start, goal)!;
    expect(path).not.toBeNull();
    for (const c of path) expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
    expect(treeCells(grid, path)).toBeGreaterThan(0);
    expect(findCellPath(grid, start, goal)).toEqual(path);
  });

  it("ploughs through only when the forest spans the lane", () => {
    // No flank exists: every lane row is wood, so the cheapest route crushes
    // a lane straight through — arriving slowly still beats never arriving,
    // and the drive fells the lane it takes (see `movement.ts` crush).
    const grid = forestGrid(8, 15, 0, 11);
    const start = { cellX: 2, cellZ: 5 };
    const goal = { cellX: 21, cellZ: 5 };
    const path = findCellPath(grid, start, goal)!;
    expect(path).not.toBeNull();
    for (const c of path) expect(isWalkable(grid, c.cellX, c.cellZ)).toBe(true);
    expect(treeCells(grid, path)).toBeGreaterThan(0);
    expect(findCellPath(grid, start, goal)).toEqual(path);
  });
});
