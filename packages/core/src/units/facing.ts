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
};

/** Hull turn rate per kind, radians per second. */
export const HULL_TURN_RATE: Record<UnitKind, number> = {
  flash: 2.0,
  stump: 1.5,
  hammer: 1.1,
  commander: 1.6,
};

/** Turret slew rate per kind, radians per second. */
export const TURRET_SLEW_RATE: Record<UnitKind, number> = {
  flash: 3.0,
  stump: 2.4,
  hammer: 1.8,
  commander: 2.2,
};

/** Aim error under which a shot may leave the muzzle, radians (~3.4°). */
export const FIRE_TOLERANCE = 0.06;

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
  /** True when the muzzle line is on the target (may fire). */
  aimed: boolean;
}

/**
 * Advance one aim step of `dt` seconds toward `targetYaw`: the hull turns at
 * its turn rate, then the turret slews the remainder at its slew rate within
 * its traverse clamp. The hull therefore does the gross motion (a target
 * behind the unit is acquired by turning around) while the turret only
 * refines — never spinning freely.
 */
export function aimStep(
  kind: UnitKind,
  hull: number,
  turret: number,
  targetYaw: number,
  dt: number,
): AimState {
  const step = Math.max(dt, 0);
  const hullRate = HULL_TURN_RATE[kind] ?? 1.5;
  const slewRate = TURRET_SLEW_RATE[kind] ?? 2.4;
  const nextHull = stepAngle(hull, targetYaw, hullRate * step);
  const want = clampTurret(kind, wrapAngle(targetYaw - nextHull));
  const nextTurret = stepAngle(turret, want, slewRate * step);
  return {
    hull: nextHull,
    turret: nextTurret,
    aimed: aimError(targetYaw, nextHull, nextTurret) <= FIRE_TOLERANCE,
  };
}
