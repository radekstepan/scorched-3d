import type { UnitKind } from "./types.js";

/**
 * Hull/turret facing helpers for the ambient skirmish. Framework-free (no
 * three.js) so the web renderer and vitest can both consume it directly.
 *
 * Convention: yaw 0 faces +Z (south, matching the terrain frame and the
 * `units.ts` meshes), growing toward +X (east), i.e. forward =
 * `(sin(yaw), cos(yaw))` on X/Z — the same sense `muzzlePoint()` uses.
 *
 * Nanolathe parallel: retail aims turrets relative to the unit heading —
 * the turret executor solves `yaw = atan2(AimFrom − target) − heading`
 * (`research/retail-executable-spec/06-weapons-projectiles-damage-and-effects.md`
 * §3.3) and the COB script turns traverse/pitch pieces toward it with a
 * `restore` back to rest (`research/formats/cob.md`; `internal/combat/service.go`
 * `aimYawForScript`). Here the hull does the gross motion (limited turn
 * rate) and the turret/barrel subgroup refines within a clamped traverse,
 * instead of a full COB program.
 */

/** Turret traverse limit per kind, radians relative to the hull. */
export const TURRET_LIMIT: Record<UnitKind, number> = {
  // Fast light tank: narrow turret, the hull does most of the work.
  flash: Math.PI / 3,
  // Medium tank: wide-traverse twin-gun turret.
  stump: (5 * Math.PI) / 12,
  // Artillery: long barrel on a limited mount.
  hammer: (5 * Math.PI) / 18,
  // Kbot: no turret mesh, so the whole torso/chest yaws ±90°.
  commander: Math.PI / 2,
  // Infantry scout: light torso twists wide to track close targets.
  peewee: Math.PI / 2,
};

/** Hull turn rate per kind, radians per second. */
export const HULL_TURN_RATE: Record<UnitKind, number> = {
  flash: 2.2,
  stump: 1.7,
  hammer: 1.3,
  commander: 1.8,
  // Infantry: nimble on its feet, spins to face fast.
  peewee: 2.7,
};

/**
 * Neutral-steer pivot floor per kind: the fraction of the hull traverse cap
 * still available at zero forward speed. Tracked hulls pivot deliberately
 * (slow neutral-steer, never a whip); walkers shuffle-turn on their legs,
 * infantry fastest — but nobody whips at full traverse standing still.
 * Held-only by construction (see `TURN_AUTHORITY_BLEND`): anything rolling
 * turns at full traverse exactly as before, so waypoint capture, beaching
 * slides, and staging lanes keep their tuned geometry.
 */
export const HULL_PIVOT_FLOOR: Record<UnitKind, number> = {
  flash: 0.35,
  stump: 0.35,
  hammer: 0.35,
  commander: 0.55,
  peewee: 0.65,
};

/**
 * Turn-authority blend, as a fraction of top speed: authority ramps from
 * the pivot floor at rest to full across this speed band, and holds full
 * past it. Deliberately UNDER the alignment-grip floor (movement
 * `GRIP_FLOOR` 0.3×): even a fully-spun hull crawls at 0.3× top speed, so
 * every rolling recovery turns at the full traverse cap — only genuinely
 * held hulls (stunned, pinned, spacing-held, stand-off facing) pivot at
 * the floor. Retail note: retail TA couples the turn to the maneuver the
 * other way (its `turnDist` test brakes the hull into the corner while the
 * turn rate stays constant — nanolathe
 * `04-units-orders-scripts-and-movement.md` [R-MOV-01 §4]); without
 * persistent speed state this codebase instead disciplines only the
 * rest pivot, leaving every rolling turn untouched.
 */
export const TURN_AUTHORITY_BLEND = 0.25;

/**
 * Turn authority 0..1: the fraction of a kind's hull traverse cap available
 * at `speed` world units/s against its `topSpeed`. Full past the blend band
 * (every rolling turn carves exactly as before), easing linearly to the
 * neutral-steer pivot floor at rest (deliberate in-place facing, never a
 * whip) — while the traverse cap still bounds every heading change and
 * turrets stay faster than hulls. Corrupt input fails to the floor: a zero
 * authority would deadlock facing, NaN would poison it.
 */
export function turnAuthority(kind: UnitKind, speed: number, topSpeed: number): number {
  const floor = HULL_PIVOT_FLOOR[kind] ?? 0.35;
  if (!Number.isFinite(speed) || !Number.isFinite(topSpeed) || !(topSpeed > 0)) return floor;
  if (speed <= 0) return floor;
  // Clamped: `floor + (1 - floor)` can round a hair past 1, which would let
  // a yaw step exceed the traverse cap.
  return Math.min(floor + (1 - floor) * Math.min(speed / (TURN_AUTHORITY_BLEND * topSpeed), 1), 1);
}

/** Turret slew rate per kind, radians per second. */
export const TURRET_SLEW_RATE: Record<UnitKind, number> = {
  // Deliberately weighty: turrets stay faster than their hulls (fine vs
  // gross motion) but traverse ~20% slower than the original tune, so
  // engagements visibly wind up before the first aimed shot leaves.
  flash: 2.4,
  stump: 1.9,
  hammer: 1.4,
  commander: 1.9,
  peewee: 2.8,
};

/** Aim error under which a shot may leave the muzzle, radians (~3.4°). */
export const FIRE_TOLERANCE = 0.06;

/**
 * Turret swings wider than this (radians) overshoot their goal: the gun
 * carries too far and has to correct back a little, the way a heavy traverse
 * does when it slews across the arc. Small corrections stay critically
 * damped and stop dead on the aim.
 */
export const TURRET_OVERSHOOT_SWING = Math.PI / 4;

/**
 * Extra turret travel past the goal on a far swing, radians (~5.7°).
 * Deliberately wider than `FIRE_TOLERANCE`, so the settle-back is a visible
 * correction: shots still gate on `canFire`, so a volley only ever leaves
 * when the muzzle is truly on the aim — never a wild shot from mid-swing.
 */
export const TURRET_OVERSHOOT = 0.1;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const tau = Math.PI * 2;
  let w = (a + Math.PI) % tau;
  if (w <= 0) w += tau;
  return w - Math.PI;
}

/** Bearing from `from` to `to` on the X/Z plane (yaw 0 = +Z). */
export function yawToTarget(
  from: { x: number; z: number },
  to: { x: number; z: number },
): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Step `current` toward `target` along the shortest arc, at most `maxStep`. */
export function stepAngle(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Clamp a turret-relative yaw to the kind's traverse limit. */
export function clampTurret(kind: UnitKind, relative: number): number {
  const limit = TURRET_LIMIT[kind] ?? Math.PI / 2;
  return Math.min(Math.max(relative, -limit), limit);
}

/** Absolute turret (muzzle) yaw from hull + turret-relative yaws. */
export function muzzleYaw(hullYaw: number, turretRel: number): number {
  return hullYaw + turretRel;
}

export interface TurretSlew {
  /** Turret-relative yaw after this step. */
  angle: number;
  /** Latched overshoot offset (0 once settled): thread it into the next step. */
  overshoot: number;
}

/**
 * Step a turret-relative yaw toward `want` (pre-clamped to the traverse) at
 * the kind's slew rate, overshooting far swings: when the remaining travel
 * exceeds `TURRET_OVERSHOOT_SWING`, the gun runs `TURRET_OVERSHOOT` past the
 * goal before correcting back — the heavy-traverse overcorrect. The latch is
 * caller state (`overshoot`, 0 at rest): arrival at the exaggerated goal
 * releases it, a goal jumping far across the arc re-latches the new way, and
 * the goal stays clamped so the turret never exceeds its traverse stop. The
 * overshoot only manifests when the caller threads the latch (unthreaded
 * steps converge dead-on, like before). Aim stays purely geometric — a volley
 * scheduled exactly as the muzzle crosses the aim still fires on target.
 */
export function slewTurret(
  kind: UnitKind,
  current: number,
  want: number,
  dt: number,
  latched = 0,
): TurretSlew {
  const step = Math.max(dt, 0);
  if (!(step > 0)) return { angle: current, overshoot: latched };
  const rate = TURRET_SLEW_RATE[kind] ?? 2.4;
  const d = wrapAngle(want - current);
  let hold = latched;
  if (hold === 0) {
    if (Math.abs(d) > TURRET_OVERSHOOT_SWING) hold = Math.sign(d) * TURRET_OVERSHOOT;
  } else if (Math.abs(d) > TURRET_OVERSHOOT_SWING && Math.sign(d) !== Math.sign(hold)) {
    hold = Math.sign(d) * TURRET_OVERSHOOT;
  }
  const goal = clampTurret(kind, want + hold);
  const angle = stepAngle(current, goal, rate * step);
  if (hold !== 0 && angle === goal) hold = 0;
  return { angle, overshoot: hold };
}

/** Residual aim error between the current aim and the target bearing. */
export function aimError(targetYaw: number, hullYaw: number, turretRel: number): number {
  return Math.abs(wrapAngle(targetYaw - (hullYaw + turretRel)));
}

/** True when the aim is close enough to fire down the muzzle line. */
export function canFire(
  targetYaw: number,
  hullYaw: number,
  turretRel: number,
  tolerance = FIRE_TOLERANCE,
): boolean {
  return aimError(targetYaw, hullYaw, turretRel) <= tolerance;
}

export interface AimState {
  hull: number;
  turret: number;
  /** Latched turret overshoot (0 at rest): thread it into the next step. */
  overshoot: number;
  /** True when the muzzle line is on the target (may fire). */
  aimed: boolean;
}

/**
 * Advance one aim step of `dt` seconds toward `targetYaw`: the hull turns at
 * its turn rate, then the turret slews the remainder at its slew rate within
 * its traverse clamp. The hull therefore does the gross motion (a target
 * behind the unit is acquired by turning around) while the turret only
 * refines — never spinning freely. The turret leg overshoots far swings (see
 * `slewTurret`); thread the returned `overshoot` (or pass 0 to converge
 * dead-on, like before).
 */
export function aimStep(
  kind: UnitKind,
  hull: number,
  turret: number,
  targetYaw: number,
  dt: number,
  turretOvershoot = 0,
): AimState {
  const step = Math.max(dt, 0);
  const hullRate = HULL_TURN_RATE[kind] ?? 1.5;
  const nextHull = stepAngle(hull, targetYaw, hullRate * step);
  const want = clampTurret(kind, wrapAngle(targetYaw - nextHull));
  const slew = slewTurret(kind, turret, want, step, turretOvershoot);
  return {
    hull: nextHull,
    turret: slew.angle,
    overshoot: slew.overshoot,
    aimed: aimError(targetYaw, nextHull, slew.angle) <= FIRE_TOLERANCE,
  };
}
