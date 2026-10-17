import { CELL_PIXELS } from "../terrain/types.js";
import { mulberry32 } from "../terrain/noise.js";
import { HULL_TURN_RATE, stepAngle, turnAuthority, wrapAngle, yawToTarget } from "./facing.js";
import { accumulateStun, IMPACT_MAX_SHOVE, impactKick, tickStun } from "./impact.js";
import {
  THREAT_LEASH_RADIUS,
  clearThreat,
  pursueStandOff,
  tickThreat,
  type ThreatMemory,
} from "./retaliation.js";
import { outnumbered, disengageRadiusFor } from "./strategy.js";
import { SIDESTEP_ARRIVE_RADIUS } from "./combat.js";
import {
  CRUSH_DRAG,
  destinationTooWet,
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
 *   alone into the stronger force, re-engaging once backup arrives. A new
 *   order (or hold) clears any live memory, but hits taken while ordered
 *   record a self-defense memory the guns answer without steering the hull
 *   (a blocked move prevents a chase, not weapon fire — retail TA); holds
 *   still record nothing. On arrival the order clears without holding, so
 *   the hull rejoins its patrol loop (pursuing a live memory first); stun
 *   only pauses the drive, the threat clock keeps ticking underneath.
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

/**
 * Alignment-grip floor: a hull spun fully around its target still drives at
 * this fraction of its top speed. Kept above the turn-authority blend
 * (facing `TURN_AUTHORITY_BLEND` 0.25×) on purpose: even the slowest rolling
 * recovery crawls faster than the blend band, so every rolling turn —
 * recovery arcs, U-turns, beaching slides — runs at the full traverse cap
 * exactly as before, and only genuinely held hulls pivot at the floor.
 * Ordered crowd push-through is the separate `ORDER_SPACING_FLOOR`.
 */
export const GRIP_FLOOR = 0.3;
/** Waypoints per looping route, including the spawn cell as waypoint 0. */
export const ROUTE_WAYPOINTS = 4;
/** Patrol radius around the spawn cell, in cells. */
export const ROUTE_RADIUS_CELLS = 45;
/** Arrival radius around a waypoint, in world units. */
export const ARRIVE_RADIUS = 14;
/**
 * Spacing: full stop inside this distance to another mover (world units).
 * Splash-aware (see `BLAST_RADIUS` in `destruction.ts`): 48 parks neighbours
 * exactly outside the heaviest bolt splash (commander 48 — a boundary hit
 * scores zero, see `applyBlastToUnits`), so a brawl shares hammer fringe at
 * most — a neighbour at the hold eats a quarter of a shell instead of half.
 */
export const STOP_RADIUS = 48;
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
 * Unordered hulls keep the hard 0 while yielding to a crowd leader, but a
 * stopped leader itself creeps at this same floor and takes no separation
 * push (see `advanceMovers`), so crowds drain in roster order instead of
 * orbiting their waypoint forever. Stacking through the floor is still
 * bounded: separation shoves harder (30 u/s) than the floor drives (≤24
 * u/s), so head-on pairs open rather than pass through each other, and the
 * parting crowd always outruns a creeping leader.
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
 * clear a 48-unit hold in ~1.6 s.
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
 * Separation-coast budget, world units: after a hull's last fresh push (see
 * `resolveSeparation`), it keeps gliding along the applied push heading for
 * up to this distance instead of stopping dead on the stop radius. A hard
 * push cutoff chatters against the homing drive — the drive pulls the pair
 * back inside every other tick, so the gap sawtooths ~1u at ~30 Hz (measured
 * on patrol crossings and pack advances) — while the coast carries the pair
 * clear of the boundary in one smooth glide and then ends exactly. The coast
 * only ever drains: it cannot re-arm without re-entering the radius, so
 * cruising convoys outside the deadlock band still feel nothing (the task-72
 * verdict stands — this is a time-decaying exit glide, not an outer band).
 */
export const SEPARATION_COAST_DISTANCE = 8;
/** Maximum change of autonomous crowd velocity, world units / second². */
export const CROWD_ACCELERATION = 100;
/**
 * Valid separation-coast budget on a mover, if any (see `Mover.sep`): finite
 * and non-zero, so a corrupted budget strips instead of steering the hull.
 */
function validSep(mover: Mover): { x: number; z: number } | undefined {
  const sep = mover.sep;
  if (!sep || !Number.isFinite(sep.x) || !Number.isFinite(sep.z)) return undefined;
  if (sep.x === 0 && sep.z === 0) return undefined;
  return sep;
}
/**
 * Blocked-drive patience, seconds: a patrolling hull pinned against too-steep
 * ground (a patrol leg can cut across a slope its waypoints straddle) skips
 * to its next waypoint after this long instead of grinding in place forever.
 * Ordered hulls never skip — a player-sent destination holds even at a steep
 * edge, which reads as "can't climb that" instead of wandering off — and an
 * ordered hull sliding along a shoreline (see `SHORE_SLIDE_FAN`) gives up
 * the slide and holds after this long, so a truly unreachable goal reads as
 * beached instead of pacing the coast forever.
 */
export const BLOCKED_SKIP_AFTER = 2.5;
/**
 * Shore-slide fan, radians: heading offsets around the turned hull heading,
 * smallest deviation first with alternating sides, that an ordered hull
 * beached on a shoreline tries when its direct step is refused. Waypoint
 * homing with arrival slop can drift a hull's track off its smoothed leg
 * and nose it onto a water corner with the waypoint across it; the fan
 * finds the closest free heading so the hull edges around the corner
 * instead of grinding in place forever. Alternation starts portside
 * (negative) so the pick is deterministic. Only ordered hulls fan, and only
 * off wet ground: patrol legs cut straight across bays (sliding would walk
 * the whole coastline instead of skipping), and steep blocks hold honestly
 * as "can't climb that". Ordered steps taken badly misaligned (hull more
 * than 60° off its waypoint) accrue `stuck` instead of clearing it, so a
 * slide that never closes on the goal burns the same patience as a hold.
 */
export const SHORE_SLIDE_FAN: readonly number[] = [
  -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6,
].map((k) => (k * Math.PI) / 12);
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
   * patrol is suspended until the order completes — arrival rejoins the
   * loop — or is replaced.
   */
  order?: MoveOrder;
  /**
   * Set via `holdMover` (or by an empty order, or on a wreck): the unit
   * holds position instead of patrolling. Cleared by a new order; arrivals
   * no longer hold — the patrol loop resumes past the destination.
   */
  hold?: boolean;
  /**
   * Retaliation threat memory (core `retaliation.ts`): who last hit this
   * hull, from where, and for how much longer. Present while a hull is
   * pursuing (or the memory is fresh) — including a self-defense memory on
   * an ordered hull (recorded by hits taken en route: the guns answer it
   * but the drive keeps the order); absent — never zero-ttl — otherwise,
   * matching the `stuck`/`stun` convention. Holding and wrecked hulls never
   * carry it (holds clear and refuse it, kills drop it), and the patrol leg
   * freezes while it steers.
   */
  threat?: ThreatMemory;
  /**
   * Departure lead-in: a one-shot via point ahead of the patrol loop. The
   * hull drives here first (patrol leg frozen), then continues onto the
   * join leg to the loop — arrival AT the loop clears the departure and
   * joins the same tick, so the departure never repeats. Retail factories
   * hand products their rally the same way (nanolathe
   * `04-units-orders-scripts-and-movement.md` §3.8: `GetBuilt` re-enqueues
   * the builder's queued move/patrol rallies onto the product in order, so
   * the product walks the rally, then patrols). The departure steers ahead
   * of pursuit: a live threat ticks underneath (expiry validated, the guns
   * keep answering it) but never steers until the exit completes — a fresh
   * release alone at the base walks all the way to staging instead of
   * holding for odds at the door. Stuns pause it; orders and holds clear
   * it (a player-sent hull never resumes a departure); slope-pinned past
   * `BLOCKED_SKIP_AFTER` it abandons to patrol. Absent — never stale —
   * once joined, matching the `stuck`/`stun` convention.
   */
  leadIn?: RoutePoint;
  /**
   * Remaining separation-coast displacement, world units along the last
   * applied push heading (see `SEPARATION_COAST_DISTANCE`): the exit glide a
   * hull keeps after leaving the stop radius, drained by `resolveSeparation`
   * at `SEPARATION_SPEED` — never re-armed except by a fresh push, so it
   * always ends exactly. Absent — never zero-length — once drained, walled
   * off (absorbed, not banked), or superseded: orders and holds clear it
   * like the departure lead-in, since explicit new intent wins over a glide.
   * Non-finite values strip instead of lingering, fail clean never stuck.
   */
  sep?: { x: number; z: number };
  /**
   * Last accepted world velocity from the roster step. `crowd` carries a
   * bounded acceleration response until it catches the current drive,
   * even after neighbours leave. The drive, shove and coast must share
   * this one response: independently smoothing either force leaves the
   * other free to reverse the actual displacement every frame. Explicit
   * orders, holds and recoil bypass it; new orders/holds clear it.
   */
  motion?: { x: number; z: number; crowd?: true };
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
  /** Roster integration defers falls until it accepts the actual step. */
  deferFelling?: boolean;
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
 * A new order cancels any in-progress pursuit (its live threat memory is
 * cleared), but hits taken while ordered record a fresh self-defense
 * memory the guns answer (see `notifyThreat`) without steering the hull —
 * and arrival rejoins the patrol loop instead of holding. Pass `groupSpeed`
 * (see `groupSpeedCap`) for orders issued together as a group: faster
 * members cap at the slowest member's pace instead of cutting ahead; single
 * orders omit it and drive at full kind speed.
 */
export function orderMover(mover: Mover, points: RoutePoint[], groupSpeed?: number): Mover {
  // A player order supersedes any departure and any separation coast: the
  // hull never resumes either — explicit new intent wins over a glide.
  const { leadIn: _superseded, sep: _glide, motion: _motion, ...rest } = clearThreat(mover);
  const calm = rest;
  if (points.length === 0) return { ...calm, order: undefined, hold: true };
  const order: MoveOrder =
    groupSpeed !== undefined && Number.isFinite(groupSpeed) && groupSpeed > 0
      ? { points: points.map((p) => ({ ...p })), at: 0, groupSpeed }
      : { points: points.map((p) => ({ ...p })), at: 0 };
  return { ...calm, order, hold: false };
}

/** Hold in place: drop any order and stop patrolling until ordered again. */
export function holdMover(mover: Mover): Mover {
  // A hold supersedes any departure and any separation coast like an order
  // does: nothing resumes them, so a held hull stops crisply.
  const { leadIn: _superseded, sep: _glide, motion: _motion, ...rest } = clearThreat(mover);
  return { ...rest, order: undefined, hold: true };
}

/** True while the mover is driving a player-issued move order. */
export function hasOrder(mover: Mover): boolean {
  const order = mover.order;
  return order !== undefined && order.at >= 0 && order.at < order.points.length;
}
/**
 * True while the mover is genuinely driving: it displaced this tick
 * (`displaced`, measured by the caller from the pre/post drive step) under
 * its own intent. Holds read stationary even when separation jostles the
 * hull, and stun beats read stationary even mid-recoil-slide — both are
 * involuntary displacement, never driving (an expired `stun: 0` counts as
 * no stun, matching the absent-not-zero convention). Everything else keys
 * off displacement alone, so orders, patrol legs, pursuits, departures,
 * footwork steps, and separation coasts all read the same way: what matters
 * is whether the hull moved, not which intent moved it. Spacing-held and
 * slope-pinned hulls read stationary with no special case — the drive
 * clamp leaves them undisplaced. The gun layer reads this (via the
 * renderer-side `isMoving` hook) to slow the refire of volleys fired on
 * the move; firing itself is never gated — see the module docstring.
 */
export function isMoverMoving(mover: Mover, displaced: boolean): boolean {
  if (mover.hold) return false;
  if ((mover.stun ?? 0) > 0) return false;
  return displaced;
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
/**
 * Neighbours (any roster index) inside `self`'s slow radius: the crowd
 * gauge. Pairs (one contact) negotiate mutually — the tuned regime,
 * chatter-free — while crowds (two or more) defer to a priority leader
 * (see `advanceMovers`), whose serial drain breaks the pinwheel that
 * mutual sidesteps spin in crowds. Pure.
 */
function slowContacts(
  self: number,
  positions: readonly { x: number; z: number }[],
  slowRadius = SLOW_RADIUS,
): number {
  const me = positions[self];
  if (!me || !(slowRadius > 0)) return 0;
  const slow2 = slowRadius * slowRadius;
  let n = 0;
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    const other = positions[i];
    if (!other) continue;
    const dx = other.x - me.x;
    const dz = other.z - me.z;
    if (dx * dx + dz * dz < slow2) n++;
  }
  return n;
}

/**
 * True while an elected higher-priority leader (a lower roster index with
 * `leaders` already set — see `advanceMovers`) sits inside `self`'s slow
 * radius: `self` yields to it and can never lead while it does. Only
 * elected leaders suppress — hulls that cannot lead themselves (holders,
 * ordered, stunned, routeless) and lone passers-by with fewer than two
 * contacts never do, so a held hull parked in a converge cannot pin the
 * whole crowd into the mutual pinwheel (measured: a lowest-index holder
 * orbited four convergers ~12 rad over 5400 ticks with nobody arriving).
 * Leadership keys on the slow zone — not the stop zone — because
 * converges orbit at slow-zone gaps (measured: four-way packs circle at
 * 48–55, dipping inside only intermittently), so a stop key would never
 * engage and the pinwheel would spin on. Pure.
 */
function yieldsToLeader(
  self: number,
  positions: readonly { x: number; z: number }[],
  leaders: readonly boolean[],
  slowRadius = SLOW_RADIUS,
): boolean {
  const me = positions[self];
  if (!me || !(slowRadius > 0)) return false;
  const slow2 = slowRadius * slowRadius;
  for (let i = 0; i < self; i++) {
    if (leaders[i] !== true) continue;
    const other = positions[i];
    if (!other) continue;
    const dx = other.x - me.x;
    const dz = other.z - me.z;
    if (dx * dx + dz * dz < slow2) return true;
  }
  return false;
}

export function spacingScale(
  self: number,
  positions: readonly { x: number; z: number }[],
  stopRadius = STOP_RADIUS,
  slowRadius = SLOW_RADIUS,
): number {
  const me = positions[self];
  if (!me) return 1;
  // Squared gates (non-positive radii gate nothing: a hypot distance is
  // never below zero, so the old strict compares read false there too).
  const stop2 = stopRadius > 0 ? stopRadius * stopRadius : -1;
  const slow2 = slowRadius > 0 ? slowRadius * slowRadius : -1;
  let scale = 1;
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    const other = positions[i];
    if (!other) continue;
    const dx = other.x - me.x;
    const dz = other.z - me.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < stop2) return 0;
    if (d2 < slow2) scale = Math.min(scale, SLOW_SCALE);
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
 * and on the final waypoint arrive → patrol resumes (order cleared, no
 * hold). A self-defense memory ticks underneath an order but never steers
 * (the hull keeps driving where it was sent). Without an order a holding
 * mover stays put; otherwise a departure lead-in drives first with the leg
 * frozen (via past the mouth, then the join leg onto the loop; arrival at
 * the loop clears it and joins the same tick; slope-pinned past patience
 * it abandons to patrol) — ahead of pursuit, so a fresh release walks all
 * the way to staging before any chase steers it — and only then
 * does a hull with a live retaliation threat pursue it (see
 * `retaliation.ts`: steer to the attacker's last-known position through
 * the same drive, freezing the patrol leg, holding at weapons-range
 * stand-off, giving up past the disengage bound / leash / memory expiry).
 * A live threat ticks underneath the departure (expiry validated, the guns
 * keep answering it) but never steers until the exit completes. Either way the hull
 * turns toward its target at the kind's turn rate, then drives
 * forward along the hull — never
 * sideways — at per-kind speed scaled by alignment grip (slow in turns,
 * like retail's capped blocked-mover speed) and the spacing factor. When
 * `terrain` is provided, steps into unwalkable/too-steep ground are refused:
 * the hull holds position and keeps turning (retail's blocked-mover
 * behavior) instead of clipping into the hillside; a patrolling hull that
 * stays pinned past `BLOCKED_SKIP_AFTER` skips to its next waypoint — while
 * an ordered hull beached on a shoreline edges around the water via the
 * `SHORE_SLIDE_FAN` instead of grinding nose-on, holding beached past
 * patience. Wood never pins: with a `crush` context a step touching
 * standing trees fells them at a `CRUSH_DRAG` crawl instead of holding.
 * `foes` carries the live roster positions so pursuit tracks a moving
 * attacker (omitted, the static last-known memory steers — which is also
 * how driven-path prediction previews a chase). Pure: returns a new mover.
 * Terrain-less stepping is byte-identical to before for threat-free hulls.
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
      if (at >= order.points.length) {
        // Arrival: the order is done and the hull rejoins its patrol loop
        // (no hold) — with a live self-defense memory intact, so a hull
        // under fire pursues like a normal patrol hull on the next tick.
        return { ...tickThreat(mover, dt), order: undefined, hold: false };
      }
      target = order.points[at]!;
    }
    const driven = driveToward(kind, mover, target, dt, spacing, terrain, { ...order, at }, crush);
    // A self-defense memory ticks underneath the order but never steers —
    // the hull keeps driving where it was sent while the guns answer the
    // attacker. `driveToward` rebuilds without it, so re-attach (like the
    // departure lead-in below); expiry drops the key.
    const { threat } = tickThreat(mover, dt);
    return threat ? { ...driven.mover, threat } : driven.mover;
  }
  if (mover.hold) return tickThreat(mover, dt);
  if (route.length < 2) return tickThreat(mover, dt);
  const leg = ((mover.leg % route.length) + route.length) % route.length;
  // Departure lead-in FIRST: a one-shot via point ahead of the patrol loop
  // (an HQ release's straight walk out of the hall mouth). The departure
  // completes AT the loop, in two phases: the straight walk to the via
  // point past the mouth (a straight leg from inside the hall to an
  // off-road point would grind through the curb wall, so the veer must
  // wait until past the mouth), then the join leg from the via onto the
  // loop — with the leg frozen throughout, and arrival joining the loop
  // the same tick, so the departure never repeats. Completing at the loop
  // (not at the mouth) is what keeps the exit clear: pursuit steers the
  // moment the departure lifts, and a mouth join would park an outnumbered
  // release at the door all over again. The phase latches by rewriting the
  // departure target to the loop point once the via is reached, so leaving
  // the via rim for the join leg can never flap the target back to the via
  // (which would dither the hull on the rim forever). Patrol patience
  // applies: slope-pinned past `BLOCKED_SKIP_AFTER` the departure abandons
  // to patrol instead of grinding. The departure steers ahead of pursuit —
  // a fresh release alone at the base must walk out before any chase
  // steers it, or the outnumbered hold parks it at the door (and the
  // sweep's per-tick advance refresh never lets the hold expire). A live
  // threat ticks underneath (expiry validated; the guns keep answering it)
  // but never steers until the exit completes.
  let calm = mover;
  const lead = calm.leadIn;
  if (lead) {
    // A non-finite departure strips instead of lingering: fail clean, never
    // fail stuck.
    if (!Number.isFinite(lead.x) || !Number.isFinite(lead.z)) {
      const { leadIn: _dropped, ...joined } = calm;
      calm = joined;
    } else {
      const join = route[leg]!;
      const ldx = lead.x - calm.x;
      const ldz = lead.z - calm.z;
      // Past the via the exit continues onto the join leg to the loop.
      const target = ldx * ldx + ldz * ldz <= ARRIVE_RADIUS * ARRIVE_RADIUS ? join : lead;
      const tdx = target.x - calm.x;
      const tdz = target.z - calm.z;
      if (tdx * tdx + tdz * tdz > ARRIVE_RADIUS * ARRIVE_RADIUS) {
        const exit = driveToward(kind, calm, target, dt, spacing, terrain, undefined, crush);
        if (exit.skipped) {
          const { leadIn: _abandoned, ...joined } = exit.mover;
          return { ...joined, leg, stuck: 0 };
        }
        // `driveToward` rebuilds the mover without the departure — re-attach
        // the (possibly latched) phase target. A live threat ticks
        // underneath like under an order (same pattern as the order branch
        // above): expiry validated, steering deferred.
        const { threat } = tickThreat(mover, dt);
        const driven: Mover = { ...exit.mover, leg, leadIn: target === join ? { ...join } : lead };
        return threat ? { ...driven, threat } : driven;
      }
      // At the loop (the only way both checks pass): join the same tick.
      const { leadIn: _arrived, ...joined } = calm;
      calm = joined;
    }
  }
  // Retaliation second: a live threat memory steers the hull instead of the
  // patrol leg (holds never carry one — they clear and refuse it; an order
  // that just completed hands its self-defense memory over here).
  // A stale key (ttl run out without a re-hit) or a give-up (disengage /
  // leash, see `pursueStep`) drops the memory and falls through to patrol.
  // By here any departure has joined, so pursuit never fights the exit.
  const threat = calm.threat;
  if (threat && threat.ttl > 0) {
    const chased = pursueStep(kind, calm, threat, route, dt, spacing, terrain, crush, foes, tactics);
    if (chased) return { ...chased, leg };
    calm = clearThreat(calm);
  } else if (threat) {
    calm = clearThreat(calm);
  }
  let target = route[leg]!;
  const dx = target.x - calm.x;
  const dz = target.z - calm.z;
  if (dx * dx + dz * dz <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
    const nextLeg = (leg + 1) % route.length;
    target = route[nextLeg]!;
    // Coincident next waypoint (degenerate loops pad with spawn copies):
    // already there — advance the leg and rest instead of driving onto
    // our own position, which re-aims every tick and dithers the hull off
    // its post. Real loops never land here (waypoints sit ≥12 cells
    // apart), so only coincident loops change. Arrival clears stale
    // blocked time like any successful step, keeping the key absent when
    // it was never set.
    const nx = target.x - calm.x;
    const nz = target.z - calm.z;
    if (nx * nx + nz * nz <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
      return calm.stuck === undefined
        ? { ...calm, leg: nextLeg }
        : { ...calm, leg: nextLeg, stuck: 0 };
    }
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
 * target (order cursor, departure lead-in, or patrol leg — frozen, never
 * advanced) at the kind's turn rate, count the clock down, and drain the
 * standing recoil slide so the hull recoils away from the blast instead of
 * freezing. Both keys drop
 * when the clock expires so recoiled-then-free snapshots compare equal with
 * never-hit ones. Pure: returns a new mover.
 */
/**
 * Turn a hull toward `want` at the kind's traverse cap scaled by turn
 * authority for `speed` (see facing `turnAuthority`): rolling hulls carve
 * at full traverse exactly as before, held hulls neutral-steer at the
 * pivot floor instead of whipping — and the cap still bounds every step.
 * Pure.
 */
function turnHull(kind: UnitKind, hull: number, want: number, dt: number, speed: number): number {
  const rate = HULL_TURN_RATE[kind] ?? 1.5;
  const top = MOVE_SPEED[kind] ?? 32;
  return stepAngle(hull, want, rate * turnAuthority(kind, speed, top) * dt);
}

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
    // A departure in progress is the current target, ahead of the leg.
    if (awake.leadIn) {
      target = awake.leadIn;
    } else {
      const leg = ((awake.leg % route.length) + route.length) % route.length;
      target = route[leg] ?? null;
    }
  }
  // A recoiling hull does not drive, so it faces its frozen target at the
  // pivot floor — deliberately, never a whip mid-rock.
  const hull = target ? turnHull(kind, awake.hull, yawToTarget(awake, target), dt, 0) : awake.hull;
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
 * A carried `sidestep` point (see `firingSidestep`) is walked first at any
 * range — through the same drive, cleared on arrival — and only then does
 * the hull hold at weapons-range stand-off facing the threat; pinned
 * against a slope it holds like an ordered hull instead of skipping its
 * frozen leg away. The step is a fresh ~1 s walk, so the hold/close
 * boundary never drops it mid-stride (dropping there self-cancelled the
 * forest-futility cure: every sidestep died the stride the hull crossed
 * stand-off and the gun kept firing into the wood). With `tactics`, a hull
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
  // A carried sidestep survives the hold/close boundary: the step is
  // scored fresh at attach (a sweep seat or a forest-futility cure) and
  // walks in ~1 s, so the geometry cannot go stale mid-stride — and
  // dropping it on the close would self-cancel the cure the stride the
  // hull crosses stand-off. Arrival clears it below; outnumbered hulls
  // keep it through the wait and walk it when the odds change.
  const holding = Math.hypot(tx - mover.x, tz - mover.z) <= pursueStandOff(kind);
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
    ...(threat.sidestep !== undefined ? { sidestep: { ...threat.sidestep } } : {}),
  };
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
    // Holding hulls do not translate, so they face at the pivot floor.
    return { ...mover, hull: turnHull(kind, mover.hull, want, dt, 0), threat: memory };
  }
  // Firing-position footwork: a hull carrying a sidestep point walks the
  // short lateral shuffle first at any range — through the same drive
  // (turn caps, grip, slope gating), so it reads as deliberate footwork,
  // not a slide. The turret tracks the threat independently while the hull
  // shuttles, so the gun never leaves the target mid-step. Arrival clears
  // the point (attachers re-arm, never the point); slope-pinned hulls hold
  // like an ordered hull with the point surviving for a later tick.
  const step = memory.sidestep;
  if (step && Number.isFinite(step.x) && Number.isFinite(step.z)) {
    if (Math.hypot(step.x - mover.x, step.z - mover.z) <= SIDESTEP_ARRIVE_RADIUS) {
      const { sidestep: _arrived, ...rest } = memory;
      return { ...mover, hull: turnHull(kind, mover.hull, want, dt, 0), threat: rest };
    }
    const shuffle = driveToward(kind, mover, step, dt, spacing, terrain, undefined, crush);
    if (shuffle.skipped) {
      return { ...mover, hull: shuffle.mover.hull, stuck: 0, threat: memory };
    }
    return { ...shuffle.mover, threat: memory };
  }
  if (holding) {
    return { ...mover, hull: turnHull(kind, mover.hull, want, dt, 0), threat: memory };
  }
  const driven = driveToward(kind, mover, { x: tx, z: tz }, dt, spacing, terrain, undefined, crush);
  if (driven.skipped) {
    return { ...mover, hull: driven.mover.hull, stuck: 0, threat: memory };
  }
  return { ...driven.mover, threat: memory };
}

/**
 * Fell the standing trees a taken drive step touches (re-tested on the
 * crush-shortened stride, so only wood actually reached falls), and report
 * the fresh falls for the renderer to re-pose.
 */
function fellTreesOnStep(
  crush: CrushContext | null | undefined,
  kind: UnitKind,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): void {
  if (crush == null || crush.deferFelling) return;
  const touched = treesCrushedByStep(
    crush.points,
    crush.field.trees,
    fromX,
    fromZ,
    toX,
    toZ,
    kind,
  );
  if (touched.length === 0) return;
  const felled: number[] = [];
  for (const fid of touched) if (crushTree(crush.field, fid)) felled.push(fid);
  if (felled.length > 0) crush.onCrush?.(felled);
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
  // Group cohesion: orders issued together cap faster members at the
  // slowest member's base speed, so the column moves as a group. Single
  // orders carry no cap and drive at full kind speed. The cap only ever
  // slows (never speeds a slow hull past its own base). Needed up front:
  // turn authority follows the speed this stride can carry.
  const kindBase = MOVE_SPEED[kind] ?? 32;
  const cap = order?.groupSpeed;
  const top = cap !== undefined && Number.isFinite(cap) && cap > 0 ? Math.min(kindBase, cap) : kindBase;
  // Forward stride for a heading `want`: alignment grip off the CURRENT
  // hull (intent — full speed lined up, `GRIP_FLOOR` spun around, so the
  // hull always faces travel, turrets aim independently while moving) times
  // rough-terrain drag and the crush crawl, probed along the current nose.
  // The turn then follows at the authority this stride carries (see
  // `turnHull`): anything rolling turns at full traverse exactly as before
  // (even the slowest recovery crawl clears the blend band), while a held
  // stride pivots at the floor instead of whipping.
  //
  // Rough-terrain drag: steep grades and trees/rocks bleed speed off the
  // step (flat open ground scales by exactly 1). Probed to the full-stride
  // candidate so the drag reads the ground the hull would actually cross;
  // the hull still refuses unwalkable steps below, this only slows allowed
  // ones. A step touching standing wood crawls further at CRUSH_DRAG —
  // ploughing a fresh lane reads much slower than brushing canopy.
  const strideFor = (want: number): number => {
    const grip = Math.max(GRIP_FLOOR, Math.cos(wrapAngle(want - mover.hull)));
    const stride = top * Math.max(spacing, 0) * grip * dt;
    const rough = terrain ? terrainSpeedScale(terrain, mover.x, mover.z, mover.x + Math.sin(mover.hull) * stride, mover.z + Math.cos(mover.hull) * stride) : 1;
    const probeX = mover.x + Math.sin(mover.hull) * stride * rough;
    const probeZ = mover.z + Math.cos(mover.hull) * stride * rough;
    const crushing =
      crush != null
        ? treesCrushedByStep(crush.points, crush.field.trees, mover.x, mover.z, probeX, probeZ, kind)
        : [];
    return stride * rough * (crushing.length > 0 ? CRUSH_DRAG : 1);
  };
  const rollToward = (want: number): { hull: number; nx: number; nz: number } => {
    const step = strideFor(want);
    const hull = turnHull(kind, mover.hull, want, dt, dt > 0 ? step / dt : 0);
    return { hull, nx: mover.x + Math.sin(hull) * step, nz: mover.z + Math.cos(hull) * step };
  };
  const baseFor = (hull: number): Pick<Mover, "hull" | "leg"> & Partial<Mover> => ({
    hull,
    leg: mover.leg,
    ...(order ? { order } : {}),
    ...(mover.hold ? { hold: true as const } : {}),
  });
  const direct = rollToward(desired);
  if (!terrain || !stepBlocked(terrain, mover.x, mover.z, direct.nx, direct.nz, kind)) {
    // Felled lanes stay felled, so later passes skip both the fell and the crawl.
    fellTreesOnStep(crush, kind, mover.x, mover.z, direct.nx, direct.nz);
    // A successful step clears accumulated blocked time — but keep the key
    // absent (not zero) when it was never set, so terrain-less history and
    // old snapshots compare equal. Exception: an ordered step taken badly
    // misaligned (hull more than 60° off its waypoint — weaving along a
    // wall, not closing on the goal) accrues instead of clearing, so
    // shoreline pacing burns the same patience as a beached hold and gives
    // up past it instead of hiking the coast forever. Aligned ordered
    // steps clear as before, and patrol/pursuit always clear (their skip
    // patience must not burn on U-turn transients).
    const aligned = !order || Math.cos(wrapAngle(desired - direct.hull)) >= 0.5;
    if (mover.stuck === undefined) {
      if (!aligned) {
        return {
          mover: { x: direct.nx, z: direct.nz, ...baseFor(direct.hull), stuck: dt },
          skipped: false,
        };
      }
      return { mover: { x: direct.nx, z: direct.nz, ...baseFor(direct.hull) }, skipped: false };
    }
    if (!aligned) {
      return {
        mover: { x: direct.nx, z: direct.nz, ...baseFor(direct.hull), stuck: mover.stuck + dt },
        skipped: false,
      };
    }
    return { mover: { x: direct.nx, z: direct.nz, ...baseFor(direct.hull), stuck: 0 }, skipped: false };
  }
  // Ordered hulls beached on a shoreline edge around the water instead of
  // grinding nose-on: fan headings around the turned hull heading
  // (kinematic probe at the direct stride), take the closest free one, and
  // drive a normal turn-limited step toward it — a far swing edges around
  // over a few ticks, the hull always facing travel. Sliding accrues stuck
  // time instead of clearing it: corner-rounding finishes in ticks, while a
  // truly unreachable goal (a straight fallback drive across open water)
  // gives up the slide past patience and holds beached. Patrol and pursuit
  // never fan, and steep blocks never fan (see `SHORE_SLIDE_FAN`).
  if (
    order &&
    terrain &&
    (mover.stuck ?? 0) < BLOCKED_SKIP_AFTER &&
    destinationTooWet(terrain, direct.nx, direct.nz)
  ) {
    const stride = Math.hypot(direct.nx - mover.x, direct.nz - mover.z);
    if (stride > 0) {
      for (const off of SHORE_SLIDE_FAN) {
        const h = direct.hull + off;
        const px = mover.x + Math.sin(h) * stride;
        const pz = mover.z + Math.cos(h) * stride;
        if (stepBlocked(terrain, mover.x, mover.z, px, pz, kind)) continue;
        const esc = rollToward(h);
        if (!stepBlocked(terrain, mover.x, mover.z, esc.nx, esc.nz, kind)) {
          fellTreesOnStep(crush, kind, mover.x, mover.z, esc.nx, esc.nz);
          return {
            mover: { x: esc.nx, z: esc.nz, ...baseFor(esc.hull), stuck: (mover.stuck ?? 0) + dt },
            skipped: false,
          };
        }
        // Still turning into the corner: hold this tick but keep the swing.
        return {
          mover: { ...mover, ...baseFor(esc.hull), stuck: (mover.stuck ?? 0) + dt },
          skipped: false,
        };
      }
    }
  }
  // Pinned: turn in place, never enter the slope. Patrol legs (no live
  // order) skip ahead once patience runs out; orders hold their ground.
  // Wood never pins — crush steps above always drive — so only walls wait.
  // Nothing rolls, so the pivot runs at the floor: deliberate, never a whip.
  const stuck = (mover.stuck ?? 0) + dt;
  const base = baseFor(turnHull(kind, mover.hull, desired, dt, 0));
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
  // Crowd leaders drain converges in roster order: an unordered hull with
  // a loop to drive, two or more slow-zone contacts (pairs negotiate
  // mutually — the tuned chatter-free regime — only crowds defer), that
  // yields to no elected lower leader in its slow zone, and is neither
  // holding nor recoiling. The leader takes no separation push at all —
  // so drive-in contact can never arm a coast and deflect it — and creeps
  // at the floor instead of stopping inside the stop zone (see
  // ORDER_SPACING_FLOOR), walking straight through the parting crowd while
  // everyone else yields and parts around it (full push, faster than the
  // creep, so nobody stacks). Coasting leaders keep the drive pause (their
  // stale glide still drains exactly once, then the creep resumes — a
  // push-free leader can never re-arm, so the pause always lifts). Without
  // the drain a converge orbits its waypoint at slow-zone gaps with nothing
  // moving but the sidestep circulation: a permanent pinwheel. Leadership
  // is acyclic (a total index order), so it can never cycle.
  const mutual = movers.map((_, i) => spacingScale(i, movers));
  const contacts = movers.map((_, i) => slowContacts(i, movers));
  // Retain priority through a crowd's final pair while its velocity response
  // is active. Dropping leadership at one remaining contact let the last
  // two convergers fall back into a mutual orbit and never reach the leg.
  // Fresh isolated pairs retain their existing mutual passing behavior.
  // Elected in roster order so each hull defers only to an already-elected
  // lower leader (well-founded: `yieldsToLeader` reads lower indices
  // alone): ineligible hulls and lone passers-by never suppress the drain.
  const leaders: boolean[] = [];
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i]!;
    leaders.push(
      !hasOrder(m) &&
        m.hold !== true &&
        (routes[i]?.length ?? 0) >= 2 &&
        (contacts[i]! >= 2 || (m.motion?.crowd === true && contacts[i]! > 0)) &&
        !yieldsToLeader(i, movers, leaders) &&
        !((m.stun ?? 0) > 0),
    );
  }
  const scales = movers.map((m, i) => {
    const scale = mutual[i] ?? 1;
    // Ordered hulls never fully stop for spacing: see ORDER_SPACING_FLOOR.
    if (hasOrder(m)) return Math.max(scale, ORDER_SPACING_FLOOR);
    // A coasting hull lets the glide carry it instead of driving back into
    // the crowd it just left: without the pause the homing drive re-enters
    // the radius mid-glide (faster than any fixed coast rate once the pair
    // axis rotates under the frozen heading) and the exit stutters. The
    // pause always lifts — the budget drains in finite time, so this can
    // never deadlock — and ordered hulls are exempt so explicit orders stay
    // alive through crowds (their floor drive is slower than the glide, and
    // the goal-opposed strip keeps the two from fighting head-on).
    if (validSep(m)) return 0;
    // Priority creep: a stopped crowd leader keeps a floor drive instead of
    // stopping (see above); leaders outside the stop zone and everyone else
    // drive the mutual scale as before.
    if (leaders[i] === true && scale === 0) return ORDER_SPACING_FLOOR;
    return scale;
  });
  // Pursuit tracks moving attackers: the pre-tick roster positions double as
  // the foe lookup (same snapshot discipline as spacing/separation). The
  // strategic context rides along per index so outnumbered hulls hold for
  // backup instead of charging alone into a stronger force.
  const deferredCrush = crush ? { ...crush, deferFelling: true } : crush;
  const driven = movers.map((m, i) =>
    advanceMover(
      kinds[i] ?? "flash", m, routes[i] ?? [], dt, scales[i] ?? 1, terrain, deferredCrush, movers,
      tactics ? { ...tactics, self: i } : null,
    ),
  );
  // Separation-coast state rides the tick, not the drive: `driveToward`
  // rebuilds movers without it (like the departure lead-in), so re-attach
  // each input's coast budget onto its driven step here — one place instead
  // of every `advanceMover` return — before the resolve drains it. Only
  // finite, non-zero budgets survive; anything else strips, fail clean.
  const coasted = driven.map((d, i) => {
    const input = movers[i];
    const sep = input ? validSep(input) : undefined;
    if (sep) {
      return { ...d, sep: { x: sep.x, z: sep.z } };
    }
    if (d.sep) {
      const { sep: _dropped, ...rest } = d;
      return rest;
    }
    return d;
  });
  const resolved = resolveSeparation(coasted, kinds, dt, terrain, leaders);
  return resolved.map((requested, i) => {
    const previous = movers[i]!;
    const kind = kinds[i] ?? "flash";
    const accepted = integrateCrowdMotion(previous, requested, contacts[i]! >= 2, kind, dt, terrain);
    // A pure separation shove never crushes wood. For an actual driven
    // step, test the accepted travel rather than the unintegrated request:
    // a slower acceleration must not fell trees it has not reached.
    const drive = driven[i]!;
    if (drive.x !== previous.x || drive.z !== previous.z) {
      fellTreesOnStep(crush, kind, previous.x, previous.z, accepted.x, accepted.z);
    }
    return accepted;
  });
}

/** One physical velocity response for drive + separation + exit coast. */
function integrateCrowdMotion(
  previous: Mover,
  requested: Mover,
  crowded: boolean,
  kind: UnitKind,
  dt: number,
  terrain?: SeatField | null,
): Mover {
  const wanted = { x: (requested.x - previous.x) / dt, z: (requested.z - previous.z) / dt };
  const saved = previous.motion;
  const prior = saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) ? saved : undefined;
  // Orders already have goal-aware separation and must never inherit a
  // backwards drift. Holds and impact recoil keep their immediate control.
  const smooth = !hasOrder(previous) && !hasOrder(requested) && !previous.hold &&
    !((previous.stun ?? 0) > 0) && (crowded || prior?.crowd === true);
  if (!smooth) return { ...requested, motion: wanted };
  const vx = prior?.x ?? 0;
  const vz = prior?.z ?? 0;
  const dx = wanted.x - vx;
  const dz = wanted.z - vz;
  const change = Math.hypot(dx, dz);
  const limit = CROWD_ACCELERATION * dt;
  if (change <= limit) return { ...requested, motion: { ...wanted, ...(crowded ? { crowd: true as const } : {}) } };
  const velocity = { x: vx + dx * limit / change, z: vz + dz * limit / change, crowd: true as const };
  let x = previous.x + velocity.x * dt;
  let z = previous.z + velocity.z * dt;
  // Inertia never grants terrain admission. Slide along a free axis, or
  // absorb it at the wall; record only actual travel so no rejected motion
  // can bank and reappear after the obstruction is gone.
  if (terrain && stepBlocked(terrain, previous.x, previous.z, x, z, kind)) {
    if (!stepBlocked(terrain, previous.x, previous.z, x, previous.z, kind)) z = previous.z;
    else if (!stepBlocked(terrain, previous.x, previous.z, previous.x, z, kind)) x = previous.x;
    else { x = previous.x; z = previous.z; }
    velocity.x = (x - previous.x) / dt;
    velocity.z = (z - previous.z) / dt;
  }
  return { ...requested, x, z, motion: velocity };
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
 * early (patrol resumes past them, off the trail), so orders rarely run
 * the whole budget.
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
 * arrival (patrol resumes past it, off the trail); patrols run until the
 * leg wraps once around the loop.
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
  const progress2 = PREDICT_PROGRESS * PREDICT_PROGRESS;
  for (let s = 0; s < total; s++) {
    const px = sim.x;
    const pz = sim.z;
    sim = advanceMover(kind, sim, legs, step, 1, terrain ?? null);
    const mx = sim.x - px;
    const mz = sim.z - pz;
    if (mx * mx + mz * mz > progress2) {
      pts.push({ x: sim.x, z: sim.z });
      stall = 0;
    } else if (++stall >= PREDICT_STALL_STEPS) {
      break;
    }
    if (hasOrder(sim)) continue;
    if (ordered) break; // Arrival: the driven path ends at the destination (patrol resumes past it).
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
 * closes. Unordered crowd leaders take no push at all (their priority
 * creep walks them through the parting crowd instead). Computed from one
 * snapshot so the resolve is symmetric and deterministic (no
 * order-of-application bias), then gated by `stepBlocked`
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
  const r2 = radius * radius;
  for (let i = 0; i < positions.length; i++) {
    if (i === self) continue;
    const other = positions[i];
    if (!other) continue;
    const dx = me.x - other.x;
    const dz = me.z - other.z;
    // Squared gate: neighbours outside the radius never pay the root — only
    // pairs that actually shove normalize.
    if (dx * dx + dz * dz >= r2) continue;
    const d = Math.hypot(dx, dz);
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
  terrain: SeatField | null | undefined,
  leaders: readonly boolean[],
): Mover[] {
  const step = SEPARATION_SPEED * dt;
  const unstacked = movers.map((mover, i) => {
    const kind = kinds[i] ?? "flash";
    const { radial, side, coincident } = separationComponents(i, movers, SEPARATION_RADIUS);
    let pushX = radial.x + side.x;
    let pushZ = radial.z + side.z;
    // Crowd leaders take no separation at all: their priority creep is the
    // drain, and any push — radial shove, sidestep, or strip remainder —
    // would deflect them into the orbit the creep exists to break (a stale
    // coast budget still drains through the no-push path below, so a leader
    // that was just yielding glides out exactly once, then creeps clean).
    // The crowd parts around them instead (everyone else takes the full
    // push), faster than the creep advances, so nobody stacks.
    if (leaders[i] === true) {
      pushX = 0;
      pushZ = 0;
    }
    if (pushX !== 0 || pushZ !== 0) {
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
        }
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      // Fresh push: the unstack step itself is unchanged (constant magnitude,
      // finite-time exit, terrain-gated with axis-slide fallback) — and a
      // move also re-arms the coast budget along the applied heading, so the
      // eventual exit glides instead of stopping dead on the radius. A push
      // walled off on every axis arms nothing: a hull that never moved has
      // no exit to smooth, and stays bit-identical to before. Explicit holds
      // never arm either: a held hull has no drive to chatter against, so it
      // exits to the radius and stops exactly there instead of gliding on
      // past its parking spot.
      const arm = mover.hold !== true;
      const nx = mover.x + pushX * step;
      const nz = mover.z + pushZ * step;
      const blocked =
        terrain != null && stepBlocked(terrain, mover.x, mover.z, nx, nz, kind);
      const slideX =
        terrain != null && blocked && !stepBlocked(terrain, mover.x, mover.z, nx, mover.z, kind);
      const slideZ =
        terrain != null &&
        blocked &&
        !slideX &&
        !stepBlocked(terrain, mover.x, mover.z, mover.x, nz, kind);
      if (terrain == null || !blocked) {
        return arm ? { ...mover, x: nx, z: nz, sep: freshCoast(pushX, pushZ) } : { ...mover, x: nx, z: nz };
      }
      // Blocked push: try sliding along one axis rather than clipping.
      if (slideX) return arm ? { ...mover, x: nx, sep: freshCoast(pushX, pushZ) } : { ...mover, x: nx };
      if (slideZ) return arm ? { ...mover, z: nz, sep: freshCoast(pushX, pushZ) } : { ...mover, z: nz };
      return mover;
    }
    // No fresh push: drain the armed coast, if any, along its stored heading
    // — the frozen direction is what kills the chatter, since the applied
    // step stays continuous across boundary crossings instead of toggling
    // 0↔full every other tick. The glide ends exactly (the last tick takes
    // only what remains), degrades to axis slides against terrain like a
    // fresh push, and absorbs against a wall instead of banking motion.
    // Explicit holds drain nothing (they never arm, so this only strips a
    // stale budget that predates the hold order — belt and braces).
    const sep = mover.sep;
    if (!sep) return mover;
    if (mover.hold === true) {
      const { sep: _stale, ...rest } = mover;
      return rest;
    }
    const remain = Math.hypot(sep.x, sep.z);
    if (!(remain > 1e-9)) {
      const { sep: _drained, ...rest } = mover;
      return rest;
    }
    const take = Math.min(remain, SEPARATION_SPEED * dt);
    const dx = (sep.x / remain) * take;
    const dz = (sep.z / remain) * take;
    const px = mover.x + dx;
    const pz = mover.z + dz;
    let ax = 0;
    let az = 0;
    if (!terrain || !stepBlocked(terrain, mover.x, mover.z, px, pz, kind)) {
      ax = dx;
      az = dz;
    } else if (dx !== 0 && !stepBlocked(terrain, mover.x, mover.z, px, mover.z, kind)) {
      ax = dx;
    } else if (dz !== 0 && !stepBlocked(terrain, mover.x, mover.z, mover.x, pz, kind)) {
      az = dz;
    } else {
      const { sep: _absorbed, ...rest } = mover;
      return rest;
    }
    const left = { x: sep.x - ax, z: sep.z - az };
    if (Math.hypot(left.x, left.z) <= 1e-9) {
      const { sep: _drained, ...rest } = mover;
      return { ...rest, x: mover.x + ax, z: mover.z + az };
    }
    return { ...mover, x: mover.x + ax, z: mover.z + az, sep: left };
  });
  return unstacked;
}

/**
 * Fresh separation-coast budget along an applied push heading: a full
 * `SEPARATION_COAST_DISTANCE` glide that `resolveSeparation` drains after
 * the hull exits the stop radius. The heading is normalized, so a crowded
 * hull coasts no further than a paired one — the budget is an exit glide,
 * not stacked momentum. The push is never zero here (callers check first).
 */
function freshCoast(pushX: number, pushZ: number): { x: number; z: number } {
  const mag = Math.hypot(pushX, pushZ);
  return {
    x: (pushX / mag) * SEPARATION_COAST_DISTANCE,
    z: (pushZ / mag) * SEPARATION_COAST_DISTANCE,
  };
}
