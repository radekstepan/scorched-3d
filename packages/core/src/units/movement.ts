import { CELL_PIXELS } from "../terrain/types.js";
import { mulberry32 } from "../terrain/noise.js";
import { HULL_TURN_RATE, stepAngle, wrapAngle, yawToTarget } from "./facing.js";
import { accumulateStun, IMPACT_MAX_SHOVE, impactKick, tickStun } from "./impact.js";
import {
  THREAT_LEASH_RADIUS,
  clearThreat,
  pursueStandOff,
  tickThreat,
  type ThreatMemory,
} from "./retaliation.js";
import { outnumbered, disengageRadiusFor } from "./strategy.js";
import {
  CRUSH_DRAG,
  stepBlocked,
  terrainSpeedScale,
  treesCrushedByStep,
  type SeatField,
} from "./terrain.js";
import { crushTree, type BlastPoint, type DamageField } from "./destruction.js";
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
 *   with patrol skipping its leg past `BLOCKED_SKIP_AFTER` — and by rough
 *   ground bleeding speed (slope-scaled drag plus tree/rock drag) — and by lateral
 *   separation in `advanceMovers`: hulls the spacing stop pins mutually
 *   (both read scale 0) shove apart along their pair axes instead of
 *   deadlocking, the way retail re-requests paths for blocked movers rather
 *   than parking them forever.
 * - Standing tree trunks crush under the tracks: the drive clamp never
 *   refuses wood — a step touching standing trees fells them (`crushTree`,
 *   reported through the crush context so the renderer re-poses the fall)
 *   at a `CRUSH_DRAG` crawl, so forest lanes cost speed instead of pinning
 *   hulls. Endpoint snaps and formation seats still prefer trunk-free cells
 *   and smoothing still refuses legs grazing trunks, so orders detour around
 *   woods when they can and plough through only when they must — while
 *   fallen trunks keep their pose, sink, and decay away like husks.
 * - `internal/content/compile_unit.go` unit-record fields (`MaxVelocity`,
 *   `TurnRate`) become per-kind `MOVE_SPEED` plus the shared hull turn-rate
 *   caps, instead of fixed-point yard-map stamping.
 * - Hit recoil (core `impact.ts` `stunDuration`, owned here as the mover
 *   `stun` countdown plus the `recoil` displacement): a splashed hull slides
 *   away from the blast over a damage-scaled beat (0.25–0.8 s, re-hits
 *   refresh under the cap) instead of freezing in place — the same
 *   side-biased, capped shove the renderer poses as the visible jerk
 *   (`impactKick`) also becomes gameplay displacement, drained at constant
 *   velocity while the rock plays. The hull still turns toward its frozen
 *   target and the crowd still jostles it; only its own drive is overridden,
 *   and the slide is terrain-gated (a hull slammed against a cliff keeps the
 *   beat but loses the slide), so recoils compose with spacing, separation,
 *   and the slope clamp instead of fighting them. Directionless hits (no
 *   blast position, or a coincident overhead blast with no flank to push
 *   along) keep the old hold: the clock ticks with no slide. Firing is
 *   deliberately untouched: the ambient scheduler owns aim/fire per
 *   attacker/target pair, and a per-victim fire pause would fight traverse
 *   without reading any clearer than the recoil plus the rock.
 * - Retaliation pursuit (core `retaliation.ts`, threat memory owned here as
 *   the mover `threat` field): a splashed idle/patrolling hull steers toward
 *   its attacker's last-known position through the same drive — freezing its
 *   patrol leg, holding at weapons-range stand-off, giving up past the
 *   disengage bound, the patrol-anchor leash, or memory expiry. With the
 *   optional strategic context (core `strategy.ts` `PursuitTactics`) an
 *   outnumbered pursuer holds in place facing the threat instead of charging
 *   alone into the stronger force, re-engaging once backup arrives. Orders and
 *   holds clear and refuse threats (player orders win); stun only pauses the
 *   drive, the threat clock keeps ticking underneath.
 */

/** Patrol speed per kind, world units per second (fast scouts → slow guns). */
export const MOVE_SPEED: Record<UnitKind, number> = {
  flash: 72,
  stump: 50,
  commander: 40,
  hammer: 34,
  // Infantry scout: the fastest feet on the field, outruns every tank.
  peewee: 80,
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
export const SLOW_SCALE = 0.5;
/**
 * Spacing floor for ordered hulls: a player-sent unit keeps at least this
 * fraction of its drive inside another mover's stop radius instead of
 * reading scale 0. Retail caps blocked movers at half `MaxVelocity` rather
 * than parking them (see the spec notes in the module docstring); the floor
 * is the same idea — an explicit order must stay alive through a crowd so a
 * hull can close the last metres to a goal near a parked unit and arrive.
 * Patrol keeps the hard 0 (ambient wandering must rest outside the hold,
 * and separation alone opens those gaps). Stacking through the floor is
 * still bounded: separation shoves harder (30 u/s) than the floor drives
 * (≤24 u/s), so head-on pairs open rather than pass through each other.
 */
export const ORDER_SPACING_FLOOR = 0.3;
/**
 * Separation: lateral push-out inside this distance to another mover (world
 * units). Equals `STOP_RADIUS` on purpose — the forward-drive stop is what
 * deadlocks (both hulls read scale 0 and grind forever), so the push acts on
 * exactly the pairs the drive refuses to close. There is deliberately no
 * push beyond this radius: a slow-zone neighbour (crawling at `SLOW_SCALE`)
 * is a convoy, not a collision — shoving cruising hulls apart fights their
 * homing drive into a wider, slower weave (measured: parallel lanes arrive
 * later with an outer band than with the crawl alone), so the crawl stands
 * and separation only un-stacks the deadlock band.
 */
export const SEPARATION_RADIUS = STOP_RADIUS;
/**
 * Separation push speed, world units per second. Faster than any hull's
 * floor drive (`MOVE_SPEED` ceiling is 80 × `ORDER_SPACING_FLOOR` 0.3 = 24)
 * so the nudge reads as jostling, not teleporting — but fast enough to
 * clear a 30-unit hold in ~1 s.
 */
export const SEPARATION_SPEED = 30;
/**
 * Sidestep weight inside the separation push, relative to the radial shove.
 * Purely radial push cannot resolve head-on crossings (the pair backs away
 * along its travel line, re-enters, and jostles forever); the perpendicular
 * sidestep opens a passing lane so crossings spiral past each other while
 * side-by-side pairs just lean apart.
 */
export const SEPARATION_SIDESTEP = 0.6;
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
/** Waypoints tolerate the same climb gate the pathfinder drives (retail-tank grade). */
const ROUTE_MAX_SLOPE = 15;
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
   * Seconds of hit-recoil beat remaining (core `stunDuration`): a hull
   * splashed by a blast slides away from it (see `recoil`) while the
   * renderer-side rock plays, then resumes its drive. The hull still turns
   * toward its target and the crowd can still jostle it via separation —
   * only forward drive is overridden — so recoils never fight spacing,
   * separation, or slope gating. Absent (not zero) when unrecoiled, matching
   * the `stuck` convention. Wrecks never carry it (the renderer refuses
   * stuns for destroyed hulls and freezes their movers), and firing is
   * untouched — see the module docstring.
   */
  stun?: number;
  /**
   * Remaining recoil displacement in world units (the `impactKick` shove for
   * the blast, stacked under `IMPACT_MAX_SHOVE`): drained at constant
   * velocity over the `stun` beat in `tickStunned`, so the hull recoils away
   * from the blast instead of freezing. Terrain-gated per tick (blocked
   * slides degrade to axis slides, then absorb), and dropped with the clock
   * on expiry. Absent — never zero — when there is nothing left to slide,
   * matching the `stun` convention; directionless hits never set it (the
   * clock ticks as a pure hold).
   */
  recoil?: { x: number; z: number };
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
  /**
   * Retaliation threat memory (core `retaliation.ts`): who last hit this
   * hull, from where, and for how much longer. Present only while an
   * idle/patrolling hull is pursuing (or memory is fresh); absent — never
   * zero-ttl — otherwise, matching the `stuck`/`stun` convention. Ordered,
   * holding, and wrecked hulls never carry it (orders/holds clear it, kills
   * drop it), and the patrol leg freezes while it steers.
   */
  threat?: ThreatMemory;
}

/**
 * A player-issued move order: waypoints in world units plus the index of
 * the waypoint currently being steered toward. Built by `orderMover()` from
 * a `findWorldPath()` result; repathing just replaces the order.
 */
export interface MoveOrder {
  points: RoutePoint[];
  at: number;
  /**
   * Group-move speed cap, world units per second: the slowest member's base
   * speed for orders issued together via `orderGroup`. Faster members drive
   * at the cap instead of cutting ahead, so the column arrives together.
   * Absent (single orders, patrol, pursuit) the kind drives at full speed.
   */
  groupSpeed?: number;
}

/**
 * Group-move cohesion cap: the slowest member's base `MOVE_SPEED`, so a
 * mixed column moves at the pace of its slowest hull. Single-kind groups
 * cap at their own speed (no-op); empty rosters read as no cap.
 */
export function groupSpeedCap(kinds: readonly UnitKind[]): number | undefined {
  if (kinds.length === 0) return undefined;
  let slowest = Infinity;
  for (const kind of kinds) {
    const speed = MOVE_SPEED[kind] ?? 32;
    if (speed < slowest) slowest = speed;
  }
  return Number.isFinite(slowest) ? slowest : undefined;
}

/**
 * Hull-crush wiring for forest drives: the caller-owned graduated
 * `DamageField` (the same one blasts and fire tick) plus its fid-ordered
 * tree positions. Driven steps fell the standing trees they touch at a
 * `CRUSH_DRAG` crawl, and `onCrush` reports the newly felled fids so the
 * renderer can re-pose the fall. Absent, drives never fell — terrain-less
 * history stays byte-identical.
 */
export interface CrushContext {
  field: DamageField;
  points: readonly BlastPoint[];
  onCrush?: (felled: number[]) => void;
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
    // Waypoints steer hull centers: a waypoint on a standing trunk would
    // park the patrol inside the wood it was routed around. The spawn
    // (waypoint 0) is exempt — relaxed placement may drop it on a trunk,
    // and the drive exit rule + trunk push-out ease it out.
    if ((field.features[cellZ * field.width + cellX] ?? 0xffff) <= 2) continue;
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
 * Player orders win over retaliation: any live threat memory is cleared, so
 * an ordered hull never peels off to pursue. Pass `groupSpeed` (see
 * `groupSpeedCap`) for orders issued together as a group: faster members
 * cap at the slowest member's pace instead of cutting ahead; single orders
 * omit it and drive at full kind speed.
 */
export function orderMover(mover: Mover, points: RoutePoint[], groupSpeed?: number): Mover {
  const calm = clearThreat(mover);
  if (points.length === 0) return { ...calm, order: undefined, hold: true };
  const order: MoveOrder =
    groupSpeed !== undefined && Number.isFinite(groupSpeed) && groupSpeed > 0
      ? { points: points.map((p) => ({ ...p })), at: 0, groupSpeed }
      : { points: points.map((p) => ({ ...p })), at: 0 };
  return { ...calm, order, hold: false };
}

/** Hold in place: drop any order and stop patrolling until ordered again. */
export function holdMover(mover: Mover): Mover {
  const calm = clearThreat(mover);
  return { ...calm, order: undefined, hold: true };
}

/** True while the mover is driving a player-issued move order. */
export function hasOrder(mover: Mover): boolean {
  const order = mover.order;
  return order !== undefined && order.at >= 0 && order.at < order.points.length;
}

/**
 * Stun a mover from a splash dealing `damageAdd` fractional damage: refresh
 * the recoil-beat countdown under the stun caps (re-hits extend, never
 * park) and — when `blast` pins the splash in world X/Z — stack the blast's
 * `impactKick` shove onto the standing recoil slide, so the hull recoils
 * away from the hit instead of freezing. Pure: returns a new mover.
 * Non-positive damage leaves the mover untouched (same move, same keys —
 * unrecoiled stays key-absent); directionless hits (no `blast`, a
 * non-finite blast, or a coincident overhead blast with no flank to push
 * along) set the clock alone and the hull holds through the beat. Wreck
 * callers must refuse stuns themselves (see `UnitMovement.stunUnit`).
 */
export function stunMover(
  mover: Mover,
  damageAdd: number,
  blast?: { x: number; z: number } | null,
): Mover {
  const current = mover.stun ?? 0;
  const next = accumulateStun(current, damageAdd);
  if (!(next > 0)) return mover;
  let recoil = mover.recoil;
  if (blast && Number.isFinite(blast.x) && Number.isFinite(blast.z)) {
    const kick = impactKick(blast.x, blast.z, mover.x, mover.z, mover.hull, damageAdd);
    if (kick.shoveX !== 0 || kick.shoveZ !== 0) {
      recoil = stackRecoil(recoil, { x: kick.shoveX, z: kick.shoveZ });
    }
  }
  if (next === current && mover.stun !== undefined && recoil === mover.recoil) return mover;
  const out: Mover = { ...mover, stun: next };
  if (recoil && (recoil.x !== 0 || recoil.z !== 0)) out.recoil = recoil;
  else delete out.recoil;
  return out;
}

/**
 * Stack a fresh recoil shove onto the standing slide, clamped to the shared
 * shove cap: sustained fire keeps pushing the hull instead of restarting
 * the slide, and a volley never launches it past `IMPACT_MAX_SHOVE`.
 * Mirrors `accumulateImpact`'s shove clamp (same cap, same magnitude
 * pinning) without the tilt the mover never poses. Pure.
 */
function stackRecoil(
  current: { x: number; z: number } | undefined,
  kick: { x: number; z: number },
): { x: number; z: number } {
  const x = (current?.x ?? 0) + kick.x;
  const z = (current?.z ?? 0) + kick.z;
  const mag = Math.hypot(x, z);
  if (mag > IMPACT_MAX_SHOVE && mag > 0) {
    return { x: (x / mag) * IMPACT_MAX_SHOVE, z: (z / mag) * IMPACT_MAX_SHOVE };
  }
  return { x, z };
}

/**
 * Speed multiplier from nearby movers: 0 inside stop radius (hold to avoid
 * stacking), SLOW_SCALE inside slow radius, 1 otherwise. Pure helper so the
 * renderer and vitest share the same spacing rule — simple slow/stop, no
 * full avoidance (that is a later task).
 *
 * NOTE: the 0 inside `STOP_RADIUS` is mutual — two hulls inside it both read
 * 0, so forward drive alone deadlocks them forever (neither can open the
 * gap the other needs). `advanceMovers` therefore applies a lateral
 * `separationVector` push after every drive step; the stop stays (hulls must
 * not drive *through* each other) but the push guarantees the pair exits
 * the hold radius. Keep the two in sync: `SEPARATION_RADIUS === STOP_RADIUS`.
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
 * Optional strategic context for retaliation pursuits (core `strategy.ts`):
 * the roster snapshot a pursuit weighs before driving into a brawl. Absent,
 * pursuits steer exactly as before — every existing caller and test holds
 * byte-identical history without it.
 */
export interface PursuitTactics {
  /** Roster index of the mover being advanced (who is asking). */
  self: number;
  /** Side per roster index (undefined for headless/team-less rosters). */
  teams: readonly (number | undefined)[];
  /** Live flags per roster index. */
  alive: readonly boolean[];
  /**
   * Health fractions remaining (1 pristine .. 0 dead), parallel to the foe
   * positions. Absent reads everyone pristine (counts-only odds).
   */
  hp?: readonly number[] | null;
}

/**
 * Advance one mover by `dt` seconds. A live move order takes precedence:
 * arrive (advance the order cursor, skipping waypoints already reached),
 * and on the final waypoint arrive → hold (order cleared, patrol does not
 * resume). Without an order a holding mover stays put; otherwise a hull
 * with a live retaliation threat pursues it (see `retaliation.ts`: steer to
 * the attacker's last-known position through the same drive, freezing the
 * patrol leg, holding at weapons-range stand-off, giving up past the
 * disengage bound / leash / memory expiry) — and only then does the patrol
 * leg advance as before. Either way the hull turns toward its target at
 * the kind's turn rate, then drives forward along the hull — never
 * sideways — at per-kind speed scaled by alignment grip (slow in turns,
 * like retail's capped blocked-mover speed) and the spacing factor. When
 * `terrain` is provided, steps into unwalkable/too-steep ground are refused:
 * the hull holds position and keeps turning (retail's blocked-mover
 * behavior) instead of clipping into the hillside; a patrolling hull that
 * stays pinned past `BLOCKED_SKIP_AFTER` skips to its next waypoint. Wood
 * never pins: with a `crush` context a step touching standing trees fells
 * them at a `CRUSH_DRAG` crawl instead of holding. `foes` carries the live
 * roster positions so pursuit tracks a moving attacker (omitted, the static
 * last-known memory steers — which is also how driven-path prediction
 * previews a chase). Pure: returns a new mover. Terrain-less stepping is
 * byte-identical to before for threat-free hulls.
 */
export function advanceMover(
  kind: UnitKind,
  mover: Mover,
  route: RoutePoint[],
  dt: number,
  spacing = 1,
  terrain?: SeatField | null,
  crush?: CrushContext | null,
  foes?: readonly { x: number; z: number }[] | null,
  tactics?: PursuitTactics | null,
): Mover {
  if (!(dt > 0)) return mover;
  // Hit-stunned: recoil away from the blast while the renderer-side rock
  // plays (the hull still turns toward its current target and the clock
  // ticks down, but no order cursor advances and no blocked time accrues —
  // so the slide never fights orders, patrol legs, or the slope clamp).
  // Separation still applies afterward in `advanceMovers`: the crowd can
  // jostle a recoiling hull, it just cannot drive itself.
  if ((mover.stun ?? 0) > 0) return tickStunned(kind, mover, route, dt, terrain);
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
    return driveToward(kind, mover, target, dt, spacing, terrain, { ...order, at }, crush).mover;
  }
  if (mover.hold) return tickThreat(mover, dt);
  if (route.length < 2) return tickThreat(mover, dt);
  const leg = ((mover.leg % route.length) + route.length) % route.length;
  // Retaliation first: a live threat memory steers the hull instead of the
  // patrol leg (orders/holds never carry one — they clear and refuse it).
  // A stale key (ttl run out without a re-hit) or a give-up (disengage /
  // leash, see `pursueStep`) drops the memory and falls through to patrol.
  let calm = mover;
  const threat = mover.threat;
  if (threat && threat.ttl > 0) {
    const chased = pursueStep(kind, mover, threat, route, dt, spacing, terrain, crush, foes, tactics);
    if (chased) return { ...chased, leg };
    calm = clearThreat(mover);
  } else if (threat) {
    calm = clearThreat(mover);
  }
  let target = route[leg]!;
  const dx = target.x - calm.x;
  const dz = target.z - calm.z;
  if (dx * dx + dz * dz <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
    const nextLeg = (leg + 1) % route.length;
    target = route[nextLeg]!;
    const driven = driveToward(kind, calm, target, dt, spacing, terrain, undefined, crush);
    if (driven.skipped) {
      return { ...driven.mover, leg: (nextLeg + 1) % route.length, stuck: 0 };
    }
    return { ...driven.mover, leg: nextLeg };
  }
  const driven = driveToward(kind, calm, target, dt, spacing, terrain, undefined, crush);
  if (driven.skipped) {
    return { ...driven.mover, leg: (leg + 1) % route.length, stuck: 0 };
  }
  return { ...driven.mover, leg };
}

/**
 * Tick a hit-stunned mover by `dt` seconds: turn the hull toward its current
 * target (order cursor or patrol leg, frozen — never advanced) at the kind's
 * turn rate, count the clock down, and drain the standing recoil slide so
 * the hull recoils away from the blast instead of freezing. Both keys drop
 * when the clock expires so recoiled-then-free snapshots compare equal with
 * never-hit ones. Pure: returns a new mover.
 */
function tickStunned(
  kind: UnitKind,
  mover: Mover,
  route: RoutePoint[],
  dt: number,
  terrain?: SeatField | null,
): Mover {
  // The threat clock keeps ticking under stun (a recoiling hull does not
  // get extra memory) — pursuit itself waits until the drive resumes.
  const awake = tickThreat(mover, dt);
  const order = awake.order;
  let target: RoutePoint | null = null;
  if (order && order.at < order.points.length) {
    target = order.points[order.at] ?? null;
  } else if (!awake.hold && route.length >= 2) {
    const leg = ((awake.leg % route.length) + route.length) % route.length;
    target = route[leg] ?? null;
  }
  const rate = HULL_TURN_RATE[kind] ?? 1.5;
  const hull = target ? stepAngle(awake.hull, yawToTarget(awake, target), rate * dt) : awake.hull;
  const clock = awake.stun ?? 0;
  const remain = tickStun(clock, dt);
  // Recoil slide: drain the standing knockback over the beat at constant
  // velocity (fraction dt/clock per tick). Terrain-gated like separation —
  // the full step degrades to axis slides, then absorbs — so a hull slammed
  // against a cliff or the shoreline keeps the beat but loses the slide,
  // while the order cursor stays frozen and no blocked time accrues: recoil
  // is involuntary, never driving. Directionless hits carry no slide and
  // hold through the beat exactly as before.
  let x = awake.x;
  let z = awake.z;
  let recoil = awake.recoil;
  const standing = recoil ? Math.hypot(recoil.x, recoil.z) : 0;
  if (standing > 0 && clock > 0) {
    const frac = Math.min(dt / clock, 1);
    const sx = recoil!.x * frac;
    const sz = recoil!.z * frac;
    const blocked = (nx: number, nz: number): boolean =>
      terrain ? stepBlocked(terrain, x, z, nx, nz, kind) : false;
    let mx = 0;
    let mz = 0;
    if (!blocked(x + sx, z + sz)) {
      mx = sx;
      mz = sz;
    } else if (sx !== 0 && !blocked(x + sx, z)) {
      mx = sx;
    } else if (sz !== 0 && !blocked(x, z + sz)) {
      mz = sz;
    }
    x += mx;
    z += mz;
    const left = { x: recoil!.x - mx, z: recoil!.z - mz };
    recoil = Math.hypot(left.x, left.z) > 1e-9 ? left : undefined;
  }
  if (!(remain > 0)) {
    const { stun: _dropped, recoil: _absorbed, ...rest } = awake;
    return { ...rest, hull, x, z };
  }
  const out: Mover = { ...awake, hull, x, z, stun: remain };
  if (recoil) out.recoil = recoil;
  else delete out.recoil;
  return out;
}

/**
 * One retaliation step for a hull with a live threat memory: steer to the
 * attacker's position (live roster position when `foes` resolves the
 * attacker index, else the last-known memory) through the same
 * `driveToward` patrol uses — turn caps, grip, drag, slope gating — with
 * the patrol leg frozen. Returns null on give-up (memory expired,
 * live attacker past the disengage bound, or threat past the leash from
 * the patrol anchor — position memories skip the disengage bound, see
 * below) so the caller drops the memory and resumes patrol.
 * Inside weapons-range stand-off the hull holds and faces the threat while
 * the memory stays fresh; pinned against a slope it holds like an ordered
 * hull instead of skipping its frozen leg away. With `tactics`, a hull
 * that would drive alone into a stronger force holds in place facing the
 * threat instead — waiting for backup, not suiciding — while the memory
 * stays fresh so it re-engages (or gives up by the usual gates) once the
 * odds change. Pure.
 */
function pursueStep(
  kind: UnitKind,
  mover: Mover,
  threat: ThreatMemory,
  route: RoutePoint[],
  dt: number,
  spacing: number,
  terrain: SeatField | null | undefined,
  crush: CrushContext | null | undefined,
  foes: readonly { x: number; z: number }[] | null | undefined,
  tactics?: PursuitTactics | null,
): Mover | null {
  const ttl = threat.ttl - dt;
  if (!(ttl > 0)) return null;
  const foe = foes?.[threat.attacker];
  const tx = foe?.x ?? threat.x;
  const tz = foe?.z ?? threat.z;
  if (!(Number.isFinite(tx) && Number.isFinite(tz))) return null;
  // Disengage (hysteresis side): an engaged hull tolerates more distance
  // than a fresh one, but past this the attacker got away — let go.
  // Scouts hold scout-range contacts (see `disengageRadiusFor`): without the
  // wider bound the drive would drop every acquisition the scout gates made
  // past the regular disengage on its first step.
  // Position memories (attacker -1: a last-known spot or an HQ structure)
  // are exempt — the quarry cannot flee, so distance from the spot is the
  // reason to advance, not a reason to give up. The anchor leash and the
  // memory expiry below still release the hull.
  if (threat.attacker >= 0 && Math.hypot(tx - mover.x, tz - mover.z) > disengageRadiusFor(kind)) return null;
  // Leash to the post: the threat must sit near the patrol anchor (route
  // waypoint 0, the spawn) or the chase would drag the hull across the map.
  // The memory carries its own leash — retaliation holds the tight anchor
  // guard, hunt acquisitions and team advances range wider (see
  // `retaliation.ts`) — and the refreshed memory keeps it, so a wide leash
  // survives every tick of the chase instead of collapsing after one step.
  const anchor = route.length > 0 ? (route[0] as RoutePoint) : { x: mover.x, z: mover.z };
  if (Math.hypot(tx - anchor.x, tz - anchor.z) > (threat.leash ?? THREAT_LEASH_RADIUS)) return null;
  // An HQ assault carries its challenger record with it (refreshed against
  // the live roster when the challenger is still up — the count survives the
  // march, so consistent fire preempts mid-push, not just on arrival).
  const foeChallenger = threat.challenger ? foes?.[threat.challenger.attacker] : undefined;
  const memory: ThreatMemory = {
    attacker: threat.attacker,
    x: tx,
    z: tz,
    ttl,
    ...(threat.leash !== undefined ? { leash: threat.leash } : {}),
    ...(threat.structure === true ? { structure: true as const } : {}),
    ...(threat.challenger !== undefined
      ? {
          challenger: {
            attacker: threat.challenger.attacker,
            hits: threat.challenger.hits,
            x: foeChallenger?.x ?? threat.challenger.x,
            z: foeChallenger?.z ?? threat.challenger.z,
          },
        }
      : {}),
  };
  const rate = HULL_TURN_RATE[kind] ?? 1.5;
  const want = yawToTarget(mover, { x: tx, z: tz });
  // Outnumbered: hold facing the threat and wait for backup instead of
  // driving alone into the stronger force. Allies count around me (who can
  // reach me), enemies around the threat (what I would drive into). The
  // memory stays fresh so the hull re-engages the moment friends arrive —
  // and the usual expiry/disengage/leash gates still release it if the
  // fight moves on without it.
  if (
    tactics && foes &&
    outnumbered(
      tactics.self, mover, { x: tx, z: tz },
      foes, tactics.teams, tactics.alive, tactics.hp,
    )
  ) {
    return { ...mover, hull: stepAngle(mover.hull, want, rate * dt), threat: memory };
  }
  if (Math.hypot(tx - mover.x, tz - mover.z) <= pursueStandOff(kind)) {
    return { ...mover, hull: stepAngle(mover.hull, want, rate * dt), threat: memory };
  }
  const driven = driveToward(kind, mover, { x: tx, z: tz }, dt, spacing, terrain, undefined, crush);
  if (driven.skipped) {
    return { ...mover, hull: driven.mover.hull, stuck: 0, threat: memory };
  }
  return { ...driven.mover, threat: memory };
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
  crush?: CrushContext | null,
): { mover: Mover; skipped: boolean } {
  const desired = yawToTarget(mover, target);
  const rate = HULL_TURN_RATE[kind] ?? 1.5;
  const endpoint = (want: number): { hull: number; nx: number; nz: number } => {
    const hull = stepAngle(mover.hull, want, rate * dt);
    // Forward grip: full speed when lined up, down to 0.3 spun around — the
    // hull always faces travel, turrets aim independently while moving.
    const grip = Math.max(0.3, Math.cos(wrapAngle(want - hull)));
    // Rough-terrain drag: steep grades and trees/rocks bleed speed off the
    // step (flat open ground scales by exactly 1). Probed to the full-stride
    // candidate so the drag reads the ground the hull would actually cross;
    // the hull still refuses unwalkable steps below, this only slows allowed
    // ones. A step touching standing wood crawls further at CRUSH_DRAG —
    // ploughing a fresh lane reads much slower than brushing canopy.
    // Group cohesion: orders issued together cap faster members at the
    // slowest member's base speed, so the column moves as a group. Single
    // orders carry no cap and drive at full kind speed. The cap only ever
    // slows (never speeds a slow hull past its own base).
    const base = MOVE_SPEED[kind] ?? 32;
    const cap = order?.groupSpeed;
    const top = cap !== undefined && Number.isFinite(cap) && cap > 0 ? Math.min(base, cap) : base;
    const stride = top * Math.max(spacing, 0) * grip * dt;
    const rough = terrain ? terrainSpeedScale(terrain, mover.x, mover.z, mover.x + Math.sin(hull) * stride, mover.z + Math.cos(hull) * stride) : 1;
    const probeX = mover.x + Math.sin(hull) * stride * rough;
    const probeZ = mover.z + Math.cos(hull) * stride * rough;
    const crushing =
      crush != null
        ? treesCrushedByStep(crush.points, crush.field.trees, mover.x, mover.z, probeX, probeZ, kind)
        : [];
    const step = stride * rough * (crushing.length > 0 ? CRUSH_DRAG : 1);
    return { hull, nx: mover.x + Math.sin(hull) * step, nz: mover.z + Math.cos(hull) * step };
  };
  const baseFor = (hull: number): Pick<Mover, "hull" | "leg"> & Partial<Mover> => ({
    hull,
    leg: mover.leg,
    ...(order ? { order } : {}),
    ...(mover.hold ? { hold: true as const } : {}),
  });
  const direct = endpoint(desired);
  if (!terrain || !stepBlocked(terrain, mover.x, mover.z, direct.nx, direct.nz, kind)) {
    // Fell the standing trees the taken step touches (re-tested on the
    // crush-shortened stride, so only wood actually reached falls), and
    // report the fresh falls for the renderer to re-pose. Felled lanes stay
    // felled, so later passes skip both the fell and the crawl.
    if (crush != null) {
      const touched = treesCrushedByStep(
        crush.points,
        crush.field.trees,
        mover.x,
        mover.z,
        direct.nx,
        direct.nz,
        kind,
      );
      if (touched.length > 0) {
        const felled: number[] = [];
        for (const fid of touched) if (crushTree(crush.field, fid)) felled.push(fid);
        if (felled.length > 0) crush.onCrush?.(felled);
      }
    }
    // A successful step clears accumulated blocked time — but keep the key
    // absent (not zero) when it was never set, so terrain-less history and
    // old snapshots compare equal.
    if (mover.stuck === undefined) {
      return { mover: { x: direct.nx, z: direct.nz, ...baseFor(direct.hull) }, skipped: false };
    }
    return { mover: { x: direct.nx, z: direct.nz, ...baseFor(direct.hull), stuck: 0 }, skipped: false };
  }
  // Pinned: turn in place, never enter the slope. Patrol legs (no live
  // order) skip ahead once patience runs out; orders hold their ground.
  // Wood never pins — crush steps above always drive — so only walls wait.
  const stuck = (mover.stuck ?? 0) + dt;
  const base = baseFor(direct.hull);
  if (!order && stuck >= BLOCKED_SKIP_AFTER) return { mover: { ...mover, ...base }, skipped: true };
  return { mover: { ...mover, ...base, stuck }, skipped: false };
}

/** Advance every mover one step, with pairwise spacing from live positions. */
export function advanceMovers(
  kinds: readonly UnitKind[],
  movers: readonly Mover[],
  routes: readonly RoutePoint[][],
  dt: number,
  terrain?: SeatField | null,
  crush?: CrushContext | null,
  tactics?: Omit<PursuitTactics, "self"> | null,
): Mover[] {
  if (!(dt > 0) || movers.length === 0) {
    // No time passes: keep the old step exactly (same refs, no separation —
    // a non-positive step must never shove hulls backwards).
    return movers.slice();
  }
  const scales = movers.map((m, i) => {
    const scale = spacingScale(i, movers);
    // Ordered hulls never fully stop for spacing: see ORDER_SPACING_FLOOR.
    return hasOrder(m) ? Math.max(scale, ORDER_SPACING_FLOOR) : scale;
  });
  // Pursuit tracks moving attackers: the pre-tick roster positions double as
  // the foe lookup (same snapshot discipline as spacing/separation). The
  // strategic context rides along per index so outnumbered hulls hold for
  // backup instead of charging alone into a stronger force.
  const driven = movers.map((m, i) =>
    advanceMover(
      kinds[i] ?? "flash", m, routes[i] ?? [], dt, scales[i] ?? 1, terrain, crush, movers,
      tactics ? { ...tactics, self: i } : null,
    ),
  );
  return resolveSeparation(driven, kinds, dt, terrain);
}

/**
 * Simulation step for driven-path prediction, seconds. A quarter second
 * keeps turn arcs visibly curved (a flash yaws 2 rad/s, so ~0.5 rad per
 * step) without costing much: the overlay re-simulates every tick.
 */
export const PREDICT_STEP = 0.25;
/**
 * Simulation cap per prediction: 80 s of drive at the default step, enough
 * for a full patrol loop on live maps. Longer loops truncate (the faint
 * static loop still shows the full context); reached destinations stop
 * early, so orders rarely run the whole budget.
 */
export const PREDICT_MAX_STEPS = 320;
/**
 * Stalled steps before a prediction gives up: a pinned ordered hull reads as
 * "can't climb that" (the trail ends at the wall) instead of burning the
 * whole budget. Patrol skips free themselves inside 2.5 s
 * (`BLOCKED_SKIP_AFTER`, 10 steps), so a longer stall means every leg is
 * pinned and the trail honestly ends where the hull sits.
 */
export const PREDICT_STALL_STEPS = 24;
/** Motion below this (world units per step) reads as pinned, not driving. */
export const PREDICT_PROGRESS = 0.5;

/**
 * Predict the polyline a hull will actually drive: simulate `advanceMover`
 * forward from the live state — hull turn-rate caps, alignment grip, rough
 * drag, and terrain gating included — so corners read as arcs and walls
 * read as stops instead of straight waypoint chords. Orders run to
 * arrival-hold; patrols run until the leg wraps once around the loop.
 * Spacing/separation from other hulls is deliberately excluded (spacing 1):
 * this is intent, not traffic. Wood crush is excluded too (it would mutate
 * the caller's damage field), so forest lanes predict at full speed. Pure:
 * the input mover and the terrain are never mutated.
 */
export function predictDrivenPath(
  kind: UnitKind,
  mover: Mover,
  route: readonly RoutePoint[],
  terrain?: SeatField | null,
  step = PREDICT_STEP,
  maxSteps = PREDICT_MAX_STEPS,
): RoutePoint[] {
  if (!(step > 0) || !(maxSteps > 0)) return [];
  const ordered = hasOrder(mover);
  if (!ordered) {
    if (mover.hold || route.length < 2) return [];
    const first = route[0]!;
    let spread = false;
    for (const p of route) {
      const dx = p.x - first.x;
      const dz = p.z - first.z;
      if (dx * dx + dz * dz > ARRIVE_RADIUS * ARRIVE_RADIUS) {
        spread = true;
        break;
      }
    }
    if (!spread) return [];
  } else if (!mover.order || mover.order.points.length === 0) {
    return [];
  }
  const n = route.length;
  const startLeg = ordered || n === 0 ? -1 : ((mover.leg % n) + n) % n;
  // The order points are shared read-only: `advanceMover` never mutates them.
  let sim: Mover = {
    ...mover,
    order: mover.order
      ? {
          at: mover.order.at,
          points: mover.order.points,
          ...(mover.order.groupSpeed !== undefined ? { groupSpeed: mover.order.groupSpeed } : {}),
        }
      : undefined,
  };
  const pts: RoutePoint[] = [{ x: sim.x, z: sim.z }];
  let looped = false;
  let stall = 0;
  const total = Math.floor(maxSteps);
  // `advanceMover` takes a mutable route array but never writes it.
  const legs = route as RoutePoint[];
  for (let s = 0; s < total; s++) {
    const px = sim.x;
    const pz = sim.z;
    sim = advanceMover(kind, sim, legs, step, 1, terrain ?? null);
    if (Math.hypot(sim.x - px, sim.z - pz) > PREDICT_PROGRESS) {
      pts.push({ x: sim.x, z: sim.z });
      stall = 0;
    } else if (++stall >= PREDICT_STALL_STEPS) {
      break;
    }
    if (hasOrder(sim)) continue;
    if (ordered) break; // Arrival-hold: the driven path ends at the destination.
    const leg = ((sim.leg % n) + n) % n;
    if (leg !== startLeg) looped = true;
    else if (looped) break;
  }
  return pts;
}

/**
 * Lateral separation steering: push hulls inside `SEPARATION_RADIUS` apart
 * along their pair axes (plus a perpendicular sidestep so head-on crossings
 * open a passing lane instead of backing up into each other), so mutually
 * stopped units (`spacingScale` 0 both ways) still exit the hold instead of
 * deadlocking. The radial shove runs at constant magnitude - deliberately
 * not a distance falloff, which would approach the stop radius
 * asymptotically and stall the pair exactly on it - and there is
 * deliberately no push beyond the radius: a slow-zone neighbour (crawling
 * at `SLOW_SCALE`) is a convoy, not a collision, and shoving cruising hulls
 * apart fights their homing drive into a wider, measurably slower weave.
 * Ordered hulls additionally never take the radial half of a push that
 * points back away from their goal (the sidestep circulation is always
 * kept): a trailer following a leader sidesteps off the line instead of
 * losing ground, so files and crossings move faster while arrival still
 * closes. Computed from one snapshot so the resolve is symmetric and
 * deterministic (no order-of-application bias), then gated by `stepBlocked`
 * when terrain is known - a push into water/steep ground degrades to axis
 * slides, then to holding, instead of clipping. Pure: returns new movers.
 */
export function separationVector(
  self: number,
  positions: readonly { x: number; z: number }[],
  radius = SEPARATION_RADIUS,
): { x: number; z: number } {
  const { radial, side } = separationComponents(self, positions, radius);
  return { x: radial.x + side.x, z: radial.z + side.z };
}

/**
 * The two halves of `separationVector`, kept separate so the resolve can
 * treat them differently: the radial shove pushes hulls apart along the
 * pair axis (this is what must never fight an ordered hull's goal), while
 * the sidestep circulation breaks mirror symmetry so crossings and
 * side-by-side pairs stagger past each other instead of backing up in
 * lockstep. `coincident` flags a hull with no pair axis at all (sharing a
 * point with another hull): its deterministic split heading is arbitrary,
 * so the resolve keeps it whole instead of judging it against the goal.
 */
function separationComponents(
  self: number,
  positions: readonly { x: number; z: number }[],
  radius: number,
): {
  radial: { x: number; z: number };
  side: { x: number; z: number };
  coincident: boolean;
} {
  const radial = { x: 0, z: 0 };
  const side = { x: 0, z: 0 };
  let coincident = false;
  const me = positions[self];
  if (!me || !(radius > 0)) return { radial, side, coincident };
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    const other = positions[i];
    if (!other) continue;
    const dx = me.x - other.x;
    const dz = me.z - other.z;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d > 1e-6) {
      // Radial shove at unit weight (constant so the pair crosses the stop
      // radius in finite time) + sidestep around the neighbour: the
      // perpendicular of the away-axis, which flips with the viewpoint, so
      // the pair always counter-steps and head-on crossings pass each other
      // instead of mirroring into a backup loop.
      const inv = 1 / d;
      const rx = dx * inv;
      const rz = dz * inv;
      radial.x += rx;
      radial.z += rz;
      side.x += -rz * SEPARATION_SIDESTEP;
      side.z += rx * SEPARATION_SIDESTEP;
    } else {
      // Coincident hulls have no pair axis: split along a deterministic
      // per-index heading (golden-angle hash) so the pair still opens.
      coincident = true;
      const angle = (self * 2.39996322972865332) % (Math.PI * 2);
      radial.x += Math.sin(angle);
      radial.z += Math.cos(angle);
    }
  }
  return { radial, side, coincident };
}

/**
 * Unit direction from a mover to its live order target (the cursor
 * waypoint), or null when it has no order — or sits on the cursor, where no
 * direction is meaningful. Used to keep separation from fighting player
 * intent (see `resolveSeparation`).
 */
function orderGoalDir(mover: Mover): { x: number; z: number } | null {
  const order = mover.order;
  if (!order || order.at < 0 || order.at >= order.points.length) return null;
  const target = order.points[order.at]!;
  const dx = target.x - mover.x;
  const dz = target.z - mover.z;
  const d = Math.hypot(dx, dz);
  if (!(d > 1e-6)) return null;
  return { x: dx / d, z: dz / d };
}

function resolveSeparation(
  movers: Mover[],
  kinds: readonly UnitKind[],
  dt: number,
  terrain?: SeatField | null,
): Mover[] {
  const step = SEPARATION_SPEED * dt;
  const unstacked = movers.map((mover, i) => {
    const kind = kinds[i] ?? "flash";
    const { radial, side, coincident } = separationComponents(i, movers, SEPARATION_RADIUS);
    let pushX = radial.x + side.x;
    let pushZ = radial.z + side.z;
    if (pushX === 0 && pushZ === 0) return mover;
    // Ordered hulls keep the lane-opening shove but never the radial part
    // that pushes them back away from their goal: a trailer following a
    // leader still sidesteps off the line (the circulation half is always
    // kept - it is what staggers pairs instead of letting them mirror in
    // lockstep), it just never loses ground. Coincident splits are exempt:
    // with no pair axis "away from the goal" is meaningless, so the
    // deterministic split stays whole and drive still opens the pair.
    // Arrival still closes, and the full-weight inner radial still opens
    // ordered deadlocks.
    const goal = coincident ? null : orderGoalDir(mover);
    if (goal) {
      const along = radial.x * goal.x + radial.z * goal.z;
      if (along < 0) {
        pushX -= along * goal.x;
        pushZ -= along * goal.z;
        if (pushX === 0 && pushZ === 0) return mover;
      }
    }
    const nx = mover.x + pushX * step;
    const nz = mover.z + pushZ * step;
    if (!terrain || !stepBlocked(terrain, mover.x, mover.z, nx, nz, kind)) {
      return { ...mover, x: nx, z: nz };
    }
    // Blocked push: try sliding along one axis rather than clipping.
    if (!stepBlocked(terrain, mover.x, mover.z, nx, mover.z, kind)) {
      return { ...mover, x: nx };
    }
    if (!stepBlocked(terrain, mover.x, mover.z, mover.x, nz, kind)) {
      return { ...mover, z: nz };
    }
    return mover;
  });
  return unstacked;
}
