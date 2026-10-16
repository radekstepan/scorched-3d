import { CELL_PIXELS } from "../terrain/types.js";
import type { UnitField } from "./place.js";

/**
 * Grid A* pathfinding for player move orders. Framework-free (no three.js)
 * so the web renderer and vitest can both consume it directly.
 *
 * Walkability mirrors the patrol-route acceptance in `movement.ts`: dry land
 * (above `seaLevel + PATH_DRY_LIFT`) with a gentle slope (at most
 * `PATH_MAX_SLOPE`). Water and steep cells are blocked. Search is
 * 8-directional with corner-cut prevention (a diagonal step needs both
 * orthogonal neighbours walkable and trunk-free, so hulls never squeeze
 * past a standing trunk's corner), octile-heuristic costs weighted by a
 * per-cell rough-terrain traverse cost (slope tiers plus tree/rock words), and a fully
 * deterministic tie-break (f, then h, then cell order), so the same order on
 * the same map always returns the same path. Raw A* routes are then
 * string-pulled (line-of-sight shortcuts that refuse legs crossing
 * tree/rock interiors, plus legs passing within trunk keepout of any
 * standing tree, plus legs threading a water/steep corner closer than a
 * hull's arrival slop) because the hulls steer at any
 * heading while the search only turns in eighths.
 *
 * Nanolathe parallels (adapted — retail runs fixed-point yard-map stamping
 * under a per-player budgeted scheduler; this is a synchronous float
 * search over the attribute grid):
 * - `internal/path/search.go`: cardinal 16 / diagonal 22 step costs with a
 *   weighted octile heuristic and turn penalties. Mirrored by the
 *   cardinal-1 / diagonal-√2 costs plus the octile heuristic here; turn
 *   penalties are skipped because hull steering already smooths corners via
 *   the alignment grip in `advanceMover`.
 * - `internal/path/smooth.go` (`SmoothKernel`): pulls the searched route
 *   taut by replacing runs of turns with one straight leg when the mover
 *   footprint can stand along it. Mirrored by `smoothCellPath()`, with the
 *   footprint test collapsed to a walkability probe along the leg.
 * - `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`
 *   positioned-broadcast formation branch: selected actors keep their
 *   offsets from the selection centroid for ground-position orders, with a
 *   squared-distance cutoff that sends outliers to the bare clicked point.
 *   Mirrored by `formationTargets()`: a deterministic ring fan around the
 *   clicked point so ordered units never stack, no cutoff (roster is 12).
 * - Same spec, MOVEINFO profiles gating cells by slope/depth thresholds per
 *   mover: mirrored by the shared dry + gentle `isWalkable` gate.
 */

/** Minimal heightfield view a path search needs (TNTMap satisfies this). */
export type PathGrid = Pick<UnitField, "width" | "height" | "heights" | "seaLevel"> & {
  /**
   * Optional attribute-grid feature words (TNTMap.features): 0–2 trees, 3–4
   * rocks, 5 metal deposit, else empty/fringe/void. Absent (older
   * synthetic-test grids) reads as open ground, so cost collapses to the
   * slope tier alone.
   */
  features?: Uint16Array | readonly number[];
};

/** A path node in attribute-grid cells. */
export interface PathCell {
  cellX: number;
  cellZ: number;
}

/** World-space X/Z of a path node (Y-up, +Z south, like the mesh frame). */
export interface PathPoint {
  x: number;
  z: number;
}

/** Cells need dry land this far above the sea, matching placement/routes. */
export const PATH_DRY_LIFT = 4;
/**
 * Steepest cell grade a hull will stand on or drive, in raw height units
 * over one cell edge. Matches retail tank movement classes (TANKSH/TANKBH
 * `MaxSlope` 15 — our roster shares one movement profile, so tanks and the
 * commander all climb like retail tanks) instead of the old 24, which let
 * hulls scale near-vertical volcanic cones. `isWalkable`, the drive clamp
 * (`stepBlocked` via `MAX_DRIVE_GRADE`), placement, and patrol waypoints all
 * read this one gate, so a leg the pathfinder blesses never reads as
 * blocked and vice versa.
 */
export const PATH_MAX_SLOPE = 15;
/** Default spacing between formation fan slots, in world units. */
export const PATH_FORMATION_SPACING = 56;
/** World radius of a standing tree trunk, in world units.
 *
 * Matches the instanced trunk geometry (`features.ts` base radius 3.2,
 * scaled up to ~1.17 for round trees): anything inside reads as a hull
 * driving through wood. Canopy overhang is deliberately excluded — hulls
 * may pass under branches, but never through the trunk itself. */
export const TRUNK_RADIUS = 4;
/**
 * Generic trunk keepout in world units: the widest hull half-width
 * (stump, 10 — see `HULL_FOOTPRINT` in `terrain.ts`) plus `TRUNK_RADIUS`.
 * Smoothing has no per-kind context, so every leg steers with the widest
 * hull's margin; drive steps refine it per kind. Stays under two cell
 * widths (32), so neighbourhood probes stay 3×3.
 */
export const TRUNK_KEEPOUT = 14;
/** Snap radius when seating an order endpoint onto walkable ground, cells. */
export const PATH_SNAP_RADIUS = 12;
/**
 * Closest a smoothed leg may pass to an unwalkable (water/steep) cell
 * center, in world units. Hulls home on waypoints with arrival slop instead
 * of tracking legs exactly, so a leg threading a blocked corner closer than
 * this can beach the hull nose-on with its waypoint across the corner — an
 * ordered hull then grinds forever (orders never skip). Kept just under one
 * cell width (16) so legs down the middle of a shoreline lane or a one-wide
 * ford still smooth, and just over the corner-graze distance (half a cell
 * diagonal, ~11.3) so every corner cut is refused. Matches the movers'
 * `ARRIVE_RADIUS` (14, see `movement.ts`; not imported — `pathfinding.ts`
 * sits below `movement.ts` in the import graph and a cycle would break the
 * barrel): arrival slop is the bound on how far a homing track can drift off
 * its leg, so legs keep one arrival radius from blocked ground.
 */
export const BLOCKED_KEEPOUT = 14;
/**
 * Minimum separation between snapped formation goals, in world units.
 * Deliberately wider than the movers' `STOP_RADIUS` (48, see `movement.ts`;
 * not imported — `pathfinding.ts` sits below `movement.ts` in the import
 * graph and a cycle would break the barrel) so arrived units hold their fan
 * instead of re-entering the mutual spacing stop and leaning on separation
 * to jostle free. Matches `PATH_FORMATION_SPACING`, so geometric ring
 * neighbours already satisfy it and re-seating only fires when snaps
 * collapse onto the same ground.
 */
export const FORMATION_MIN_SEPARATION = 56;

function idx(grid: PathGrid, x: number, z: number): number {
  return z * grid.width + x;
}

function inBounds(grid: PathGrid, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < grid.width && z < grid.height;
}

function cellSlope(grid: PathGrid, x: number, z: number): number {
  const h00 = grid.heights[idx(grid, x, z)] ?? 0;
  const h10 = grid.heights[idx(grid, Math.min(grid.width - 1, x + 1), z)] ?? 0;
  const h01 = grid.heights[idx(grid, x, Math.min(grid.height - 1, z + 1))] ?? 0;
  return Math.max(h00, h10, h01) - Math.min(h00, h10, h01);
}

/** True when the cell holds a standing tree (feature words 0–2). */
export function isTreeCell(grid: PathGrid, x: number, z: number): boolean {
  if (!inBounds(grid, x, z) || !grid.features) return false;
  const word = grid.features[z * grid.width + x] ?? 0xffff;
  return word <= 2;
}

/** True when the cell holds rock or a metal deposit (words 3–5). */
export function isRockCell(grid: PathGrid, x: number, z: number): boolean {
  if (!inBounds(grid, x, z) || !grid.features) return false;
  const word = grid.features[z * grid.width + x] ?? 0xffff;
  return word >= 3 && word <= 5;
}

/** True when a cell slows hulls: standing trees, rocks, or metal deposits. */
export function isObstructedCell(grid: PathGrid, x: number, z: number): boolean {
  return isTreeCell(grid, x, z) || isRockCell(grid, x, z);
}

/**
 * Extra A* step cost of entering a walkable cell, on top of the base 1 /
 * √2 stride: gentle grades ride near 1 while rough grades, woods, and rocks
 * cost more, so the search prefers open easy ground but still routes through
 * the rough when it must. Blocked cells (water/steep) never reach here —
 * `isWalkable` gates them out. Missing `features` reads as open ground.
 */
export function cellTraverseCost(grid: PathGrid, x: number, z: number): number {
  const slope = cellSlope(grid, x, z);
  let cost = 1;
  // Rough-grade tiers at roughly 1/3, 3/5, 4/5 of the climb gate (retail
  // stamps `BadSlope` ≈ `MaxSlope` / 2 as its soft tier; the extra bands
  // keep near-gate grades expensive without ever blocking — blocking is the
  // `isWalkable` gate's job alone).
  if (slope > 12) cost += 3;
  else if (slope > 9) cost += 1.5;
  else if (slope > 5) cost += 0.5;
  if (isRockCell(grid, x, z)) cost += 2;
  else if (isTreeCell(grid, x, z)) cost += 1.25;
  return cost;
}

/** True when a mover may stand on (and path through) a cell. */
export function isWalkable(grid: PathGrid, x: number, z: number): boolean {
  if (!inBounds(grid, x, z)) return false;
  if ((grid.heights[idx(grid, x, z)] ?? 0) <= grid.seaLevel + PATH_DRY_LIFT) return false;
  return cellSlope(grid, x, z) <= PATH_MAX_SLOPE;
}

/**
 * Nearest walkable cell to (x, z) within `radius` (breadth-first rings, so
 * the closest cell wins; ties break toward smaller z, then smaller x).
 * Prefers cells without a standing trunk: hulls seat their centers on the
 * goal, so snapping onto a tree cell would park the hull inside the trunk
 * it just routed around. Falls back to any walkable cell when the whole
 * neighbourhood is woods (dense stands stay reachable, drive refusals then
 * hold at the trunk line instead of clipping), and to the clamped input
 * when nothing walkable is in range.
 */
export function nearestWalkable(grid: PathGrid, x: number, z: number, radius = PATH_SNAP_RADIUS): PathCell {
  const cx = Math.min(Math.max(Math.round(x), 0), grid.width - 1);
  const cz = Math.min(Math.max(Math.round(z), 0), grid.height - 1);
  if (isWalkable(grid, cx, cz) && !isTreeCell(grid, cx, cz)) return { cellX: cx, cellZ: cz };
  for (const wantOpen of [true, false]) {
    for (let r = 0; r <= Math.max(radius, 0); r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!isWalkable(grid, cx + dx, cz + dz)) continue;
          if (wantOpen && isTreeCell(grid, cx + dx, cz + dz)) continue;
          return { cellX: cx + dx, cellZ: cz + dz };
        }
      }
    }
  }
  return { cellX: cx, cellZ: cz };
}

const SQRT2 = Math.SQRT2;

/** Octile distance: the admissible heuristic for 8-directional movement. */
export function octileHeuristic(dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  return Math.max(ax, az) + (SQRT2 - 1) * Math.min(ax, az);
}

const DIRS: { dx: number; dz: number; diag: boolean }[] = [
  { dx: 1, dz: 0, diag: false },
  { dx: -1, dz: 0, diag: false },
  { dx: 0, dz: 1, diag: false },
  { dx: 0, dz: -1, diag: false },
  { dx: 1, dz: 1, diag: true },
  { dx: 1, dz: -1, diag: true },
  { dx: -1, dz: 1, diag: true },
  { dx: -1, dz: -1, diag: true },
];

/**
 * A* over walkable cells. Returns the cell path from start to goal
 * (inclusive) or null when the goal is unreachable. Deterministic: the open
 * heap orders by (f, h, z, x), so neighbour discovery order never matters.
 */
export function findCellPath(grid: PathGrid, start: PathCell, goal: PathCell): PathCell[] | null {
  if (!inBounds(grid, start.cellX, start.cellZ) || !inBounds(grid, goal.cellX, goal.cellZ)) return null;
  if (!isWalkable(grid, start.cellX, start.cellZ) || !isWalkable(grid, goal.cellX, goal.cellZ)) {
    return start.cellX === goal.cellX && start.cellZ === goal.cellZ
      ? [{ cellX: start.cellX, cellZ: start.cellZ }]
      : null;
  }
  if (start.cellX === goal.cellX && start.cellZ === goal.cellZ) {
    return [{ cellX: start.cellX, cellZ: start.cellZ }];
  }
  const w = grid.width;
  const h = grid.height;
  const g = new Float64Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const si = idx(grid, start.cellX, start.cellZ);
  g[si] = 0;
  // Open heap of cell indices, ordered by (f, h, z, x).
  const open: number[] = [si];
  const fOf = (i: number): number => {
    const x = i % w;
    const z = (i / w) | 0;
    return (g[i] ?? Infinity) + octileHeuristic(goal.cellX - x, goal.cellZ - z);
  };
  const less = (a: number, b: number): boolean => {
    const fa = fOf(a);
    const fb = fOf(b);
    if (fa !== fb) return fa < fb;
    const ax = a % w;
    const az = (a / w) | 0;
    const bx = b % w;
    const bz = (b / w) | 0;
    const ha = octileHeuristic(goal.cellX - ax, goal.cellZ - az);
    const hb = octileHeuristic(goal.cellX - bx, goal.cellZ - bz);
    if (ha !== hb) return ha < hb;
    if (az !== bz) return az < bz;
    return ax < bx;
  };
  const push = (i: number): void => {
    open.push(i);
    let c = open.length - 1;
    while (c > 0) {
      const p = ((c - 1) / 2) | 0;
      if (!less(open[c] ?? -1, open[p] ?? -1)) break;
      [open[c], open[p]] = [open[p] ?? -1, open[c] ?? -1];
      c = p;
    }
  };
  const pop = (): number => {
    const top = open[0] ?? -1;
    const last = open.pop() ?? -1;
    if (open.length > 0) {
      open[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < open.length && less(open[l] ?? -1, open[m] ?? -1)) m = l;
        if (r < open.length && less(open[r] ?? -1, open[m] ?? -1)) m = r;
        if (m === p) break;
        [open[p], open[m]] = [open[m] ?? -1, open[p] ?? -1];
        p = m;
      }
    }
    return top;
  };

  const gi = idx(grid, goal.cellX, goal.cellZ);
  let expansions = 0;
  while (open.length > 0) {
    const cur = pop();
    if ((closed[cur] ?? 0) === 1) continue;
    closed[cur] = 1;
    if (cur === gi) break;
    if (++expansions > w * h) return null;
    const cx = cur % w;
    const cz = (cur / w) | 0;
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const nz = cz + d.dz;
      if (!isWalkable(grid, nx, nz)) continue;
      // No corner cutting: a diagonal step needs both orthogonal sides open.
      if (d.diag && (!isWalkable(grid, cx + d.dx, cz) || !isWalkable(grid, cx, cz + d.dz))) continue;
      // No trunk squeezing either: a diagonal step past a standing trunk
      // grazes its keepout (~11 world units at the corner) even when both
      // orthogonal sides are walkable, so hulls would clip the wood the
      // search threaded. Orthogonal neighbours of a diagonal stay ≥16 away
      // and clear the widest keepout.
      if (d.diag && (isTreeCell(grid, cx + d.dx, cz) || isTreeCell(grid, cx, cz + d.dz))) continue;
      const ni = idx(grid, nx, nz);
      if ((closed[ni] ?? 0) === 1) continue;
      // Rough-terrain weighting: the stride pays the destination cell's
      // traverse cost, so woods/rocks/rough grades lose ties to open ground
      // without ever becoming unwalkable. The octile heuristic stays
      // admissible (minimum cell cost is 1).
      const ng = (g[cur] ?? Infinity) + (d.diag ? SQRT2 : 1) * cellTraverseCost(grid, nx, nz);
      if (ng < (g[ni] ?? Infinity)) {
        g[ni] = ng;
        came[ni] = cur;
        push(ni);
      }
    }
  }
  if ((g[gi] ?? Infinity) === Infinity) return null;
  const cells: PathCell[] = [];
  let cur: number = gi;
  while (cur !== -1) {
    cells.push({ cellX: cur % w, cellZ: (cur / w) | 0 });
    cur = came[cur] ?? -1;
  }
  cells.reverse();
  return cells;
}

/**
 * True when a mover can walk the straight leg a→b: every sampled cell along
 * the segment (half-cell steps, so narrow water slits are never skipped) is
 * walkable. Endpoints are assumed walkable (callers snap them first).
 */
export function hasLineOfSight(grid: PathGrid, a: PathCell, b: PathCell): boolean {
  const dx = b.cellX - a.cellX;
  const dz = b.cellZ - a.cellZ;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist * 2));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.round(a.cellX + dx * t);
    const z = Math.round(a.cellZ + dz * t);
    if (!isWalkable(grid, x, z)) return false;
  }
  return true;
}

/**
 * True when the straight leg a→b crosses a tree/rock cell interior: sampled
 * at half-cell steps like line of sight. Used to keep string-pulling from
 * undoing the rough-terrain detours A* paid for — a shortcut through woods
 * would ride at vegetation drag while the searched route walks open ground.
 * Endpoints are exempt (callers snap them onto walkable cells that may
 * themselves hold a feature word).
 */
export function legCrossesObstruction(grid: PathGrid, a: PathCell, b: PathCell): boolean {
  if (!grid.features) return false;
  const dx = b.cellX - a.cellX;
  const dz = b.cellZ - a.cellZ;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist * 2));
  for (let s = 1; s < steps; s++) {
    const x = Math.round(a.cellX + dx * (s / steps));
    const z = Math.round(a.cellZ + dz * (s / steps));
    if (isObstructedCell(grid, x, z)) return true;
  }
  return false;
}

/**
 * Squared distance from world point (px, pz) to the world segment a→b.
 * Shared by the path leg check here and the drive clamp in `terrain.ts`.
 */
export function segmentPointDistSq(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (!(len2 > 0)) {
    const ox = px - ax;
    const oz = pz - az;
    return ox * ox + oz * oz;
  }
  const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / len2, 0), 1);
  const ox = px - (ax + dx * t);
  const oz = pz - (az + dz * t);
  return ox * ox + oz * oz;
}

/**
 * True when the straight leg a→b passes within trunk keepout of any
 * standing tree. Complements `legCrossesObstruction` (which only sees whole
 * cell interiors): a leg skirting the corner of a tree cell never samples
 * the tree cell itself, yet a hull driving it would still clip the trunk —
 * the keepout circles reach past the cell edge. Candidates are gathered
 * from a 5×5 neighbourhood around each half-cell sample (endpoints
 * included, unlike the obstruction check — arriving *on* a trunk counts as
 * clipping it), then tested exactly against the segment, so long legs stay
 * linear in their length instead of scanning the whole bounding area.
 * Deterministic: boolean result, no order dependence.
 */
export function legClipsTrunk(
  grid: PathGrid,
  a: PathCell,
  b: PathCell,
  keepout = TRUNK_KEEPOUT,
): boolean {
  if (!grid.features || !(keepout > 0)) return false;
  const ax = (a.cellX - (grid.width - 1) / 2) * CELL_PIXELS;
  const az = (a.cellZ - (grid.height - 1) / 2) * CELL_PIXELS;
  const bx = (b.cellX - (grid.width - 1) / 2) * CELL_PIXELS;
  const bz = (b.cellZ - (grid.height - 1) / 2) * CELL_PIXELS;
  const dx = b.cellX - a.cellX;
  const dz = b.cellZ - a.cellZ;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) * 2));
  const r2 = keepout * keepout;
  const seen = new Set<number>();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx0 = Math.round(a.cellX + dx * t);
    const cz0 = Math.round(a.cellZ + dz * t);
    for (let oz = -2; oz <= 2; oz++) {
      for (let ox = -2; ox <= 2; ox++) {
        const cx = cx0 + ox;
        const cz = cz0 + oz;
        if (!inBounds(grid, cx, cz)) continue;
        const id = cz * grid.width + cx;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!isTreeCell(grid, cx, cz)) continue;
        const tx = (cx - (grid.width - 1) / 2) * CELL_PIXELS;
        const tz = (cz - (grid.height - 1) / 2) * CELL_PIXELS;
        if (segmentPointDistSq(ax, az, bx, bz, tx, tz) < r2) return true;
      }
    }
  }
  return false;
}

/**
 * True when the straight leg a→b passes within `keepout` of any unwalkable
 * (water/steep) cell center. Complements `hasLineOfSight` (which only sees
 * sampled cells): a leg threading the corner between a blocked cell and its
 * walkable neighbours never samples the blocked cell itself, yet a hull
 * homing on the far waypoint with arrival slop can drift off the leg and
 * beach nose-on against that corner — with the waypoint across it, an
 * ordered hull grinds forever. Candidates are gathered from a 5×5
 * neighbourhood around each half-cell sample, then tested exactly against
 * the segment — the same shape as `legClipsTrunk`, with the same linear-in-
 * length cost. Endpoints need no exemption: they are walkable cells, so only
 * their blocked neighbours are tested, and a straight arrival at a shoreline
 * cell still clears (≥16 from the water it sits beside) while a diagonal
 * arrival across the water corner is refused. Deterministic: boolean
 * result, no order dependence.
 */
export function legClipsBlocked(
  grid: PathGrid,
  a: PathCell,
  b: PathCell,
  keepout = BLOCKED_KEEPOUT,
): boolean {
  if (!(keepout > 0)) return false;
  const ax = (a.cellX - (grid.width - 1) / 2) * CELL_PIXELS;
  const az = (a.cellZ - (grid.height - 1) / 2) * CELL_PIXELS;
  const bx = (b.cellX - (grid.width - 1) / 2) * CELL_PIXELS;
  const bz = (b.cellZ - (grid.height - 1) / 2) * CELL_PIXELS;
  const dx = b.cellX - a.cellX;
  const dz = b.cellZ - a.cellZ;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) * 2));
  const r2 = keepout * keepout;
  const seen = new Set<number>();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx0 = Math.round(a.cellX + dx * t);
    const cz0 = Math.round(a.cellZ + dz * t);
    for (let oz = -2; oz <= 2; oz++) {
      for (let ox = -2; ox <= 2; ox++) {
        const cx = cx0 + ox;
        const cz = cz0 + oz;
        if (!inBounds(grid, cx, cz)) continue;
        const id = cz * grid.width + cx;
        if (seen.has(id)) continue;
        seen.add(id);
        if (isWalkable(grid, cx, cz)) continue;
        const tx = (cx - (grid.width - 1) / 2) * CELL_PIXELS;
        const tz = (cz - (grid.height - 1) / 2) * CELL_PIXELS;
        if (segmentPointDistSq(ax, az, bx, bz, tx, tz) < r2) return true;
      }
    }
  }
  return false;
}

/**
 * Greedy string-pulling: from each kept waypoint, jump to the farthest
 * later waypoint with line of sight. Collapses open-ground zigzags to
 * straight legs while keeping the water/steep detours A* paid for — and,
 * new, the wood/rock detours: a shortcut crossing a tree/rock interior is
 * refused so smoothing never pulls a route back through the rough the
 * cost tiers walked around. Trunk keepout applies on top (`legClipsTrunk`):
 * even a leg through open cells is refused when it would skirt within a
 * trunk's keepout circle, so smoothed legs never graze the wood they
 * route around — and blocked keepout (`legClipsBlocked`) refuses legs
 * threading a water/steep corner closer than a hull's arrival slop, so a
 * waypoint-homing hull can never beach nose-on against a corner its leg
 * threaded.
 */
export function smoothCellPath(grid: PathGrid, cells: PathCell[]): PathCell[] {
  if (cells.length < 3) return [...cells];
  const out: PathCell[] = [cells[0]!];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let jump = anchor + 1;
    for (let k = cells.length - 1; k > anchor + 1; k--) {
      if (
        hasLineOfSight(grid, cells[anchor]!, cells[k]!) &&
        !legCrossesObstruction(grid, cells[anchor]!, cells[k]!) &&
        !legClipsTrunk(grid, cells[anchor]!, cells[k]!) &&
        !legClipsBlocked(grid, cells[anchor]!, cells[k]!)
      ) {
        jump = k;
        break;
      }
    }
    out.push(cells[jump]!);
    anchor = jump;
  }
  return out;
}

/** World-space X/Z of an attribute-grid cell center. */
export function pathCellToWorld(grid: Pick<PathGrid, "width" | "height">, cell: PathCell): PathPoint {
  return {
    x: (cell.cellX - (grid.width - 1) / 2) * CELL_PIXELS,
    z: (cell.cellZ - (grid.height - 1) / 2) * CELL_PIXELS,
  };
}

/** Nearest attribute-grid cell for a world-space X/Z (clamped in-bounds). */
export function pathWorldToCell(
  grid: Pick<PathGrid, "width" | "height">,
  x: number,
  z: number,
): PathCell {
  return {
    cellX: Math.min(Math.max(Math.round(x / CELL_PIXELS + (grid.width - 1) / 2), 0), grid.width - 1),
    cellZ: Math.min(Math.max(Math.round(z / CELL_PIXELS + (grid.height - 1) / 2), 0), grid.height - 1),
  };
}

/**
 * End-to-end move-order path: snap both endpoints onto walkable ground
 * (off trunks — see `nearestWalkable`), run A*, string-pull, and convert
 * to world waypoints. Intermediate waypoints sitting on trunk cells are
 * nudged onto open ground and the legs re-pulled once, so a hull never
 * drives into the trunk its own waypoint sits on. Falls back to the
 * (snapped) goal alone — a straight drive — when no route exists, so an
 * order always does something predictable instead of stranding the unit.
 */
export function findWorldPath(
  grid: PathGrid,
  from: PathPoint,
  to: PathPoint,
): PathPoint[] {
  const startCell = pathWorldToCell(grid, from.x, from.z);
  const goalCell = pathWorldToCell(grid, to.x, to.z);
  const start = nearestWalkable(grid, startCell.cellX, startCell.cellZ);
  const goal = nearestWalkable(grid, goalCell.cellX, goalCell.cellZ);
  const cells = findCellPath(grid, start, goal);
  if (!cells) return [pathCellToWorld(grid, goal)];
  const smoothed = smoothCellPath(grid, cells);
  const seated = smoothed.map((c, i) =>
    i > 0 && i < smoothed.length - 1 && isTreeCell(grid, c.cellX, c.cellZ)
      ? nearestWalkable(grid, c.cellX, c.cellZ, 2)
      : c,
  );
  const deduped = seated.filter(
    (c, i) => i === 0 || c.cellX !== seated[i - 1]!.cellX || c.cellZ !== seated[i - 1]!.cellZ,
  );
  return smoothCellPath(grid, deduped).map((c) => pathCellToWorld(grid, c));
}

/**
 * Deterministic formation fan: slot 0 takes the clicked point, the rest fan
 * out on concentric hex rings (`6 * ring` slots each) at `spacing` world
 * units. No centroid math (roster is 12, not 30 — retail's cutoff never
 * triggers), so every ordered unit gets its own nearby destination instead
 * of stacking on one point.
 */
export function formationOffsets(count: number, spacing = PATH_FORMATION_SPACING): PathPoint[] {
  const out: PathPoint[] = [];
  if (count <= 0) return out;
  out.push({ x: 0, z: 0 });
  let ring = 1;
  while (out.length < count) {
    const slots = 6 * ring;
    for (let s = 0; s < slots && out.length < count; s++) {
      const angle = (s / slots) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: Math.cos(angle) * ring * spacing, z: Math.sin(angle) * ring * spacing });
    }
    ring++;
  }
  return out;
}

/** Formation fan slots translated onto a clicked world-space destination. */
export function formationTargets(
  center: PathPoint,
  count: number,
  spacing = PATH_FORMATION_SPACING,
): PathPoint[] {
  return formationOffsets(count, spacing).map((o) => ({ x: center.x + o.x, z: center.z + o.z }));
}

/**
 * Formation goals snapped onto walkable ground with a separation guarantee:
 * each geometric slot is seated via `nearestWalkable`, then — in slot order,
 * so slot 0 keeps the clicked point — any goal inside
 * `FORMATION_MIN_SEPARATION` of an accepted earlier goal is re-seated by
 * scanning expanding cell rings around its own slot for the first walkable
 * cell far enough from every accepted goal. Deterministic (fixed ring order,
 * first match wins); falls back to the plain snap when the ground is too
 * constrained to separate (dense islets), in which case the movers'
 * separation steering still un-stacks the arrivals. Prefer this over raw
 * `formationTargets` whenever a grid is available — independent per-unit
 * snaps of adjacent slots can otherwise collapse onto one cell and park the
 * pair inside the mutual spacing stop.
 */
export function snappedFormationTargets(
  grid: PathGrid,
  center: PathPoint,
  count: number,
  spacing = PATH_FORMATION_SPACING,
): PathPoint[] {
  if (count <= 0) return [];
  const accepted: PathPoint[] = [];
  const slots = formationTargets(center, count, spacing);
  for (const slot of slots) {
    const cell = pathWorldToCell(grid, slot.x, slot.z);
    const snapped = nearestWalkable(grid, cell.cellX, cell.cellZ);
    let goal = pathCellToWorld(grid, snapped);
    // Re-seat when the snap is unwalkable (deep-water click with no shore
    // in snap radius — same fallback semantics as `findWorldPath`) or when
    // it crowds an accepted earlier goal.
    if (!isWalkable(grid, snapped.cellX, snapped.cellZ) || !farEnough(goal, accepted)) {
      const rescue = firstSeparatedCell(grid, cell, accepted);
      if (rescue) goal = pathCellToWorld(grid, rescue);
    }
    accepted.push(goal);
  }
  return accepted;
}

function farEnough(candidate: PathPoint, accepted: readonly PathPoint[]): boolean {
  return accepted.every(
    (g) => Math.hypot(g.x - candidate.x, g.z - candidate.z) >= FORMATION_MIN_SEPARATION,
  );
}

function firstSeparatedCell(
  grid: PathGrid,
  around: PathCell,
  accepted: readonly PathPoint[],
  radius = PATH_SNAP_RADIUS,
): PathCell | null {
  // Two passes like `nearestWalkable`: trunk-free cells first so arrivals
  // never seat on a trunk, then any walkable cell (dense-woods fallback).
  for (const wantOpen of [true, false]) {
    for (let r = 1; r <= Math.max(radius, 0); r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cell = { cellX: around.cellX + dx, cellZ: around.cellZ + dz };
          if (!inBounds(grid, cell.cellX, cell.cellZ) || !isWalkable(grid, cell.cellX, cell.cellZ)) {
            continue;
          }
          if (wantOpen && isTreeCell(grid, cell.cellX, cell.cellZ)) continue;
          if (farEnough(pathCellToWorld(grid, cell), accepted)) return cell;
        }
      }
    }
  }
  return null;
}
