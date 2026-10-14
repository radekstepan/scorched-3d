import { CELL_PIXELS } from "../terrain/types.js";
import { mulberry32 } from "../terrain/noise.js";
import { HULL_TURN_RATE, stepAngle, wrapAngle, yawToTarget } from "./facing.js";
import { stepBlocked, type SeatField } from "./terrain.js";
import type { UnitKind } from "./types.js";
import type { UnitField } from "./place.js";

/**
 * Autonomous patrol routes for the ambient skirmish. Framework-free (no
 * three.js) so the web renderer and vitest can both consume it directly.
 *
 * Each unit gets a looping route of world-space waypoints on dry, gentle
 * terrain, generated deterministically per map seed. Movers advance along
 * their route at a per-kind speed with the hull facing the direction of
 * travel inside the same turn-rate limits combat uses (`HULL_TURN_RATE`) —
 * no sliding or instant snaps. Turrets stay combat-driven (see `facing.ts`
 * `aimStep` / `CombatFx` external-hull mode) and fire on the move.
 *
 * Nanolathe parallels (adapted, no retail pathfinder here):
 * - `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`:
 *   patrol arrival rotates to the next waypoint (outcome table §8: arrival
 *   `code 6 rotate to the next patrol point`), mirrored by the looping `leg`
 *   advance; MOVEINFO movement profiles gate cells by slope/depth thresholds,
 *   mirrored by the dry + gentle waypoint acceptance; a blocked mover "keeps
 *   turning, speed capped at half MaxVelocity", mirrored by the alignment
 *   grip (slow in turns) plus the spacing stop/slow instead of full
 *   avoidance — and now by the terrain clamp in `terrain.ts`: steps into
 *   unwalkable/too-steep ground hold position while the hull keeps turning,
 *   with patrol skipping its leg past `BLOCKED_SKIP_AFTER`.
 * - `internal/content/compile_unit.go` unit-record fields (`MaxVelocity`,
 *   `TurnRate`) become per-kind `MOVE_SPEED` plus the shared hull turn-rate
 *   caps, instead of fixed-point yard-map stamping.
 */

/** Patrol speed per kind, world units per second (fast scouts → slow guns). */
export const MOVE_SPEED: Record<UnitKind, number> = {
  flash: 58,
  stump: 40,
  commander: 32,
  hammer: 26,
};

/** Waypoints per looping route, including the spawn cell as waypoint 0. */
export const ROUTE_WAYPOINTS = 4;
/** Patrol radius around the spawn cell, in cells. */
export const ROUTE_RADIUS_CELLS = 45;
/** Arrival radius around a waypoint, in world units. */
export const ARRIVE_RADIUS = 14;
/** Spacing: full stop inside this distance to another mover (world units). */
export const STOP_RADIUS = 30;
/** Spacing: crawl at SLOW_SCALE inside this distance (world units). */
export const SLOW_RADIUS = 72;
/** Speed multiplier while inside SLOW_RADIUS of another mover. */
export const SLOW_SCALE = 0.35;
/**
 * Blocked-drive patience, seconds: a patrolling hull pinned against too-steep
 * ground (a patrol leg can cut across a slope its waypoints straddle) skips
 * to its next waypoint after this long instead of grinding in place forever.
 * Ordered hulls never skip — a player-sent destination holds even at a steep
 * edge, which reads as "can't climb that" instead of wandering off.
 */
export const BLOCKED_SKIP_AFTER = 2.5;
/** Waypoints need dry land this far above the sea, matching placement. */
const ROUTE_DRY_LIFT = 4;
/** Waypoints tolerate relaxed-grade slopes, matching relaxed placement. */
const ROUTE_MAX_SLOPE = 24;
/** Minimum separation between waypoints on one route, in cells. */
const ROUTE_WP_SEPARATION = 12;
/** Fresh RNG stream so routes never perturb terrain/unit snapshots. */
const ROUTE_RNG_XOR = 0x3ec1;

/** A patrol waypoint in world units (Y-up, +Z south, like the mesh frame). */
export interface RoutePoint {
  x: number;
  z: number;
}

/** Live patrol state: world position, hull yaw, and target waypoint index. */
export interface Mover {
  x: number;
  z: number;
  hull: number;
  /** Index of the waypoint currently being steered toward. */
  leg: number;
  /**
   * Accumulated seconds spent blocked against too-steep ground. Patrol
   * skips its leg past `BLOCKED_SKIP_AFTER`; orders ignore it (they hold).
   */
  stuck?: number;
  /**
   * Player-issued move order: a smoothed world-space waypoint list with a
   * cursor. Present while the unit drives to an ordered destination;
   * patrol is suspended until the order completes or is replaced. Chosen
   * over patrol-resume so an ordered unit stays where it was sent.
   */
  order?: MoveOrder;
  /**
   * Set when a move order completes (or via `holdMover`): the unit holds
   * position instead of patrolling. Cleared by a new order; patrol never
   * auto-resumes so orders stay where they were put.
   */
  hold?: boolean;
}

/**
 * A player-issued move order: waypoints in world units plus the index of
 * the waypoint currently being steered toward. Built by `orderMover()` from
 * a `findWorldPath()` result; repathing just replaces the order.
 */
export interface MoveOrder {
  points: RoutePoint[];
  at: number;
}

/** World-space X/Z of an attribute-grid cell center. */
export function worldFromCell(
  field: Pick<UnitField, "width" | "height">,
  cellX: number,
  cellZ: number,
): RoutePoint {
  return {
    x: (cellX - (field.width - 1) / 2) * CELL_PIXELS,
    z: (cellZ - (field.height - 1) / 2) * CELL_PIXELS,
  };
}

/** Nearest attribute-grid cell for a world-space X/Z (clamped in-bounds). */
export function cellFromWorld(
  field: Pick<UnitField, "width" | "height">,
  x: number,
  z: number,
): { cellX: number; cellZ: number } {
  return {
    cellX: Math.min(Math.max(Math.round(x / CELL_PIXELS + (field.width - 1) / 2), 0), field.width - 1),
    cellZ: Math.min(Math.max(Math.round(z / CELL_PIXELS + (field.height - 1) / 2), 0), field.height - 1),
  };
}

/** Raw (unexaggerated) terrain height under a world-space X/Z. */
export function sampleGround(field: UnitField, x: number, z: number): number {
  const { cellX, cellZ } = cellFromWorld(field, x, z);
  return field.heights[cellZ * field.width + cellX] ?? 0;
}

/**
 * Deterministically plan one looping patrol route per unit: waypoint 0 is
 * the spawn cell, the rest are sampled on dry, gentle ground within patrol
 * radius. Reads the heightfield only, so terrain snapshots never shift.
 */
export function planRoutes(
  field: UnitField,
  units: readonly { cellX: number; cellZ: number }[],
  seed: number,
): RoutePoint[][] {
  const rng = mulberry32((seed ^ ROUTE_RNG_XOR) >>> 0);
  return units.map((u) => generateRoute(field, rng, u.cellX, u.cellZ));
}

function generateRoute(
  field: UnitField,
  rng: () => number,
  startX: number,
  startZ: number,
): RoutePoint[] {
  const pts: RoutePoint[] = [worldFromCell(field, startX, startZ)];
  const taken: { cellX: number; cellZ: number }[] = [{ cellX: startX, cellZ: startZ }];
  for (let n = 0; n < 400 && pts.length < ROUTE_WAYPOINTS; n++) {
    const cellX = Math.min(
      Math.max(Math.round(startX + (rng() * 2 - 1) * ROUTE_RADIUS_CELLS), 2),
      field.width - 3,
    );
    const cellZ = Math.min(
      Math.max(Math.round(startZ + (rng() * 2 - 1) * ROUTE_RADIUS_CELLS), 2),
      field.height - 3,
    );
    if ((field.heights[cellZ * field.width + cellX] ?? 0) <= field.seaLevel + ROUTE_DRY_LIFT) continue;
    if (cellSlope(field, cellX, cellZ) > ROUTE_MAX_SLOPE) continue;
    if (taken.some((t) => Math.hypot(t.cellX - cellX, t.cellZ - cellZ) < ROUTE_WP_SEPARATION)) continue;
    taken.push({ cellX, cellZ });
    pts.push(worldFromCell(field, cellX, cellZ));
  }
  // Degenerate fallback (e.g. a spawn with no gentle ground nearby): pad with
  // the spawn so the loop stays well-formed and the unit holds position.
  while (pts.length < ROUTE_WAYPOINTS) pts.push({ ...pts[0]! });
  return pts;
}

function cellSlope(field: UnitField, x: number, z: number): number {
  const h00 = field.heights[z * field.width + x] ?? 0;
  const h10 = field.heights[z * field.width + Math.min(field.width - 1, x + 1)] ?? 0;
  const h01 = field.heights[Math.min(field.height - 1, z + 1) * field.width + x] ?? 0;
  return Math.max(h00, h10, h01) - Math.min(h00, h10, h01);
}

/** Seed live patrol state at a route's spawn waypoint, steering at leg 1. */
export function initMover(route: RoutePoint[], hull: number): Mover {
  const start = route[0] ?? { x: 0, z: 0 };
  return { x: start.x, z: start.z, hull, leg: route.length > 1 ? 1 : 0 };
}

/**
 * Issue (or repath) a move order: the mover leaves patrol and drives the
 * given world-space waypoints in order, clearing any hold. An empty path
 * holds the unit in place instead of stranding it on a degenerate order.
 */
export function orderMover(mover: Mover, points: RoutePoint[]): Mover {
  if (points.length === 0) return { ...mover, order: undefined, hold: true };
  return { ...mover, order: { points: points.map((p) => ({ ...p })), at: 0 }, hold: false };
}

/** Hold in place: drop any order and stop patrolling until ordered again. */
export function holdMover(mover: Mover): Mover {
  return { ...mover, order: undefined, hold: true };
}

/** True while the mover is driving a player-issued move order. */
export function hasOrder(mover: Mover): boolean {
  const order = mover.order;
  return order !== undefined && order.at >= 0 && order.at < order.points.length;
}

/**
 * Speed multiplier from nearby movers: 0 inside stop radius (hold to avoid
 * stacking), SLOW_SCALE inside slow radius, 1 otherwise. Pure helper so the
 * renderer and vitest share the same spacing rule — simple slow/stop, no
 * full avoidance (that is a later task).
 */
export function spacingScale(
  self: number,
  positions: readonly { x: number; z: number }[],
  stopRadius = STOP_RADIUS,
  slowRadius = SLOW_RADIUS,
): number {
  const me = positions[self];
  if (!me) return 1;
  let scale = 1;
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    const other = positions[i];
    if (!other) continue;
    const d = Math.hypot(other.x - me.x, other.z - me.z);
    if (d < stopRadius) return 0;
    if (d < slowRadius) scale = Math.min(scale, SLOW_SCALE);
  }
  return scale;
}

/**
 * Advance one mover by `dt` seconds. A live move order takes precedence:
 * arrive (advance the order cursor, skipping waypoints already reached),
 * and on the final waypoint arrive → hold (order cleared, patrol does not
 * resume). Without an order a holding mover stays put; otherwise the patrol
 * leg advances as before. Either way the hull turns toward its target at
 * the kind's turn rate, then drives forward along the hull — never
 * sideways — at per-kind speed scaled by alignment grip (slow in turns,
 * like retail's capped blocked-mover speed) and the spacing factor. When
 * `terrain` is provided, steps into unwalkable/too-steep ground are refused:
 * the hull holds position and keeps turning (retail's blocked-mover
 * behavior) instead of clipping into the hillside; a patrolling hull that
 * stays pinned past `BLOCKED_SKIP_AFTER` skips to its next waypoint. Pure:
 * returns a new mover. Terrain-less stepping is byte-identical to before.
 */
export function advanceMover(
  kind: UnitKind,
  mover: Mover,
  route: RoutePoint[],
  dt: number,
  spacing = 1,
  terrain?: SeatField | null,
): Mover {
  if (!(dt > 0)) return mover;
  const order = mover.order;
  if (order && order.at < order.points.length) {
    let at = order.at;
    let target = order.points[at]!;
    const dx0 = target.x - mover.x;
    const dz0 = target.z - mover.z;
    if (dx0 * dx0 + dz0 * dz0 <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
      at += 1;
      if (at >= order.points.length) return { ...mover, order: undefined, hold: true };
      target = order.points[at]!;
    }
    return driveToward(kind, mover, target, dt, spacing, terrain, { ...order, at }).mover;
  }
  if (mover.hold) return mover;
  if (route.length < 2) return mover;
  let leg = ((mover.leg % route.length) + route.length) % route.length;
  let target = route[leg]!;
  const dx = target.x - mover.x;
  const dz = target.z - mover.z;
  if (dx * dx + dz * dz <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
    leg = (leg + 1) % route.length;
    target = route[leg]!;
  }
  const driven = driveToward(kind, mover, target, dt, spacing, terrain);
  if (driven.skipped) {
    return { ...driven.mover, leg: (leg + 1) % route.length, stuck: 0 };
  }
  return { ...driven.mover, leg };
}

/** Turn the hull toward `target` and drive forward along it. */
function driveToward(
  kind: UnitKind,
  mover: Mover,
  target: RoutePoint,
  dt: number,
  spacing: number,
  terrain?: SeatField | null,
  order?: MoveOrder,
): { mover: Mover; skipped: boolean } {
  const desired = yawToTarget(mover, target);
  const rate = HULL_TURN_RATE[kind] ?? 1.5;
  const hull = stepAngle(mover.hull, desired, rate * dt);
  // Forward grip: full speed when lined up, down to 0.3 spun around — the
  // hull always faces travel, turrets aim independently while moving.
  const grip = Math.max(0.3, Math.cos(wrapAngle(desired - hull)));
  const step = (MOVE_SPEED[kind] ?? 32) * Math.max(spacing, 0) * grip * dt;
  const nx = mover.x + Math.sin(hull) * step;
  const nz = mover.z + Math.cos(hull) * step;
  const base = {
    hull,
    leg: mover.leg,
    ...(order ? { order } : {}),
    ...(mover.hold ? { hold: true as const } : {}),
  };
  if (terrain && stepBlocked(terrain, mover.x, mover.z, nx, nz)) {
    // Pinned: turn in place, never enter the slope. Patrol legs (no live
    // order) skip ahead once patience runs out; orders hold their ground.
    const stuck = (mover.stuck ?? 0) + dt;
    if (!order && stuck >= BLOCKED_SKIP_AFTER) return { mover: { ...mover, ...base }, skipped: true };
    return { mover: { ...mover, ...base, stuck }, skipped: false };
  }
  // A successful step clears accumulated blocked time — but keep the key
  // absent (not zero) when it was never set, so terrain-less history and
  // old snapshots compare equal.
  if (mover.stuck === undefined) {
    return { mover: { x: nx, z: nz, ...base }, skipped: false };
  }
  return { mover: { x: nx, z: nz, ...base, stuck: 0 }, skipped: false };
}

/** Advance every mover one step, with pairwise spacing from live positions. */
export function advanceMovers(
  kinds: readonly UnitKind[],
  movers: readonly Mover[],
  routes: readonly RoutePoint[][],
  dt: number,
  terrain?: SeatField | null,
): Mover[] {
  const scales = movers.map((_, i) => spacingScale(i, movers));
  return movers.map((m, i) =>
    advanceMover(kinds[i] ?? "flash", m, routes[i] ?? [], dt, scales[i] ?? 1, terrain),
  );
}
